const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const si = require('systeminformation');
const os = require('os');
const { exec } = require('child_process');
const fs = require('fs');
const https = require('https');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Historical data storage
const HISTORY_FILE = path.join(__dirname, 'data', 'metrics-history.json');
const MAX_HISTORY_POINTS = 2880; // 24 hours of data (every 30 seconds = 2880 points)
const DATA_COLLECTION_INTERVAL = 30000; // 30 seconds
const CLEANUP_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
let metricsHistory = [];

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Explicit favicon route
app.get('/favicon.ico', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'favicon.ico'));
});

// Route for the dashboard
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API endpoint for system metrics
app.get('/api/metrics', async (req, res) => {
    try {
        const metrics = await getSystemMetrics();
        res.json(metrics);
    } catch (error) {
        console.error('Error getting metrics:', error);
        res.status(500).json({ error: 'Failed to get system metrics' });
    }
});

// API endpoint for historical data
app.get('/api/history', (req, res) => {
    try {
        const hours = parseInt(req.query.hours) || 24;
        const filteredHistory = getHistoricalData(hours);
        res.json(filteredHistory);
    } catch (error) {
        console.error('Error getting historical data:', error);
        res.status(500).json({ error: 'Failed to get historical data' });
    }
});

// Load historical data on startup
loadHistoricalData();

// Historical data functions
function loadHistoricalData() {
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            const data = fs.readFileSync(HISTORY_FILE, 'utf8');
            metricsHistory = JSON.parse(data);
            console.log(`Loaded ${metricsHistory.length} historical data points`);
        } else {
            // Create data directory if it doesn't exist
            const dataDir = path.dirname(HISTORY_FILE);
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
            }
        }
    } catch (error) {
        console.error('Error loading historical data:', error);
        metricsHistory = [];
    }
}

function saveHistoricalData() {
    try {
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(metricsHistory, null, 2));
    } catch (error) {
        console.error('Error saving historical data:', error);
    }
}

function addToHistory(metrics) {
    const timestamp = new Date().toISOString();
    const historyPoint = {
        timestamp,
        cpu: parseFloat(metrics.cpu.usage_percent),
        memory: parseFloat(metrics.memory.used_percent),
        disk: parseFloat(metrics.disk.used_percent),
        load_1: parseFloat(metrics.cpu.load_1),
        load_5: parseFloat(metrics.cpu.load_5),
        load_15: parseFloat(metrics.cpu.load_15)
    };
    
    metricsHistory.push(historyPoint);
    
    // Keep only the last MAX_HISTORY_POINTS
    if (metricsHistory.length > MAX_HISTORY_POINTS) {
        metricsHistory = metricsHistory.slice(-MAX_HISTORY_POINTS);
    }
    
    saveHistoricalData();
}

function getHistoricalData(hours = 24) {
    const now = new Date();
    const cutoffTime = new Date(now.getTime() - (hours * 60 * 60 * 1000));
    
    return metricsHistory.filter(point => 
        new Date(point.timestamp) >= cutoffTime
    );
}

// Automatic cleanup function
function performDailyCleanup() {
    const now = new Date();
    const cutoffTime = new Date(now.getTime() - CLEANUP_INTERVAL);
    
    const originalLength = metricsHistory.length;
    metricsHistory = metricsHistory.filter(point => 
        new Date(point.timestamp) >= cutoffTime
    );
    
    if (originalLength !== metricsHistory.length) {
        console.log(`Cleaned up ${originalLength - metricsHistory.length} old data points`);
        saveHistoricalData();
    }
}

// Schedule daily cleanup
setInterval(performDailyCleanup, CLEANUP_INTERVAL);

// System metrics collection function
async function getSystemMetrics() {
    try {
        // Basic system info
        const hostname = os.hostname();
        const uptime = formatUptime(os.uptime());
        const osInfo = await si.osInfo();
        const currentTime = new Date().toLocaleString();

        // CPU info and usage
        const cpuInfo = await si.cpu();
        const currentLoad = await si.currentLoad();
        const loadAvg = os.loadavg();

        // Memory info - Enhanced calculation like NodeQuery
        const mem = await si.mem();
        // More accurate memory calculation: subtract buffers and cache from used memory
        const actualMemUsed = mem.used - (mem.buffers || 0) - (mem.cached || 0);
        const memUsedPercent = ((actualMemUsed / mem.total) * 100).toFixed(1);

        // Disk usage
        const fsSize = await si.fsSize();
        
        // Check if we're in WSL and prefer Windows C: drive over WSL virtual disk
        let rootFs = fsSize.find(fs => fs.mount === '/');
        const windowsC = fsSize.find(fs => fs.mount === '/mnt/c');
        
        // If in WSL and Windows C drive is available, use that instead
        if (windowsC && rootFs && rootFs.size > windowsC.size * 1.5) {
            rootFs = windowsC;
        } else if (!rootFs) {
            rootFs = fsSize[0];
        }
        
        const diskUsedPercent = rootFs ? ((rootFs.used / rootFs.size) * 100).toFixed(0) : 0;

        // Top processes
        const processes = await si.processes();
        const topProcessesCpu = processes.list
            .filter(p => p.cpu > 0)
            .sort((a, b) => b.cpu - a.cpu)
            .slice(0, 10)
            .map(p => ({
                name: p.name,
                cpu: p.cpu.toFixed(1),
                mem: p.mem.toFixed(1)
            }));

        const topProcessesMem = processes.list
            .filter(p => p.mem > 0)
            .sort((a, b) => b.mem - a.mem)
            .slice(0, 10)
            .map(p => ({
                name: p.name,
                cpu: p.cpu.toFixed(1),
                mem: p.mem.toFixed(1)
            }));

        // Enhanced Network monitoring
        const networkStats = await si.networkStats();
        const networkInterfaces = await si.networkInterfaces();
        
        // Find primary network interface (like NodeQuery does)
        const primaryInterface = networkInterfaces.find(iface => 
            iface.default || iface.internal === false
        ) || networkInterfaces[0];
        
        // Get network connections count
        const connections = await si.networkConnections();
        const activeConnections = connections.length;
        
        // Enhanced network activity including cumulative stats
        const networkActivity = {
            interface: primaryInterface?.iface || 'N/A',
            incoming: formatBytes(networkStats[0]?.rx_sec || 0) + '/s',
            outgoing: formatBytes(networkStats[0]?.tx_sec || 0) + '/s',
            rx_total: formatBytes(networkStats[0]?.rx_bytes || 0),
            tx_total: formatBytes(networkStats[0]?.tx_bytes || 0),
            connections: activeConnections
        };

        // Service status (Apache)
        const serviceStatus = await checkServiceStatus('apache2');
        
        // Enhanced system information
        const users = await si.users();
        const currentSessions = users.length;
        
        // Get public IP address
        const publicIP = await getPublicIP();
        
        // Get file handle information (like NodeQuery)
        let fileHandles = 'N/A';
        let fileHandlesLimit = 'N/A';
        
        try {
            const fs = require('fs');
            const fileNrData = fs.readFileSync('/proc/sys/fs/file-nr', 'utf8').trim().split('\t');
            if (fileNrData.length >= 3) {
                fileHandles = fileNrData[0];
                fileHandlesLimit = fileNrData[2];
            }
        } catch (err) {
            // Fallback if /proc/sys/fs/file-nr is not available
        }

        const serverTime = new Date();
        const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const offsetMinutes = serverTime.getTimezoneOffset();
        const offsetHours = Math.abs(Math.floor(offsetMinutes / 60));
        const offsetMins = Math.abs(offsetMinutes % 60);
        const offsetSign = offsetMinutes <= 0 ? '+' : '-';
        const utcOffset = `UTC ${offsetSign}${offsetHours.toString().padStart(2, '0')}:${offsetMins.toString().padStart(2, '0')}`;
        
        // Format server time
        const day = serverTime.getDate();
        const month = serverTime.toLocaleDateString('en-US', { month: 'long' });
        const year = serverTime.getFullYear();
        const hours = serverTime.getHours().toString().padStart(2, '0');
        const minutes = serverTime.getMinutes().toString().padStart(2, '0');
        const formattedServerTime = `${day} ${month} ${year} ${hours}:${minutes}`;
        
        return {
            metadata: {
                hostname,
                public_ip: publicIP,
                os: `${osInfo.distro} ${osInfo.release}`,
                uptime,
                reported_at: currentTime,
                timezone: timeZone,
                timezone_offset: utcOffset,
                server_time: formattedServerTime
            },
            cpu: {
                usage_percent: currentLoad.currentLoad.toFixed(1),
                model: cpuInfo.manufacturer + ' ' + cpuInfo.brand,
                speed: cpuInfo.speed ? `${cpuInfo.speed} GHz` : 'Unknown',
                cores: cpuInfo.cores,
                physical_cores: cpuInfo.physicalCores,
                cores_display: `${cpuInfo.physicalCores} cores • ${cpuInfo.cores} threads`,
                load_1: loadAvg[0].toFixed(2),
                load_5: loadAvg[1].toFixed(2),
                load_15: loadAvg[2].toFixed(2)
            },
            memory: {
                used_percent: memUsedPercent,
                total_mb: Math.round(mem.total / 1024 / 1024),
                used_mb: Math.round(actualMemUsed / 1024 / 1024),
                available_mb: Math.round(mem.available / 1024 / 1024),
                total_gb: (mem.total / 1024 / 1024 / 1024).toFixed(1),
                cached_mb: Math.round((mem.cached || 0) / 1024 / 1024),
                buffers_mb: Math.round((mem.buffers || 0) / 1024 / 1024)
            },
            disk: {
                used_percent: diskUsedPercent,
                total_gb: rootFs ? (rootFs.size / 1024 / 1024 / 1024).toFixed(1) : 0,
                used_gb: rootFs ? (rootFs.used / 1024 / 1024 / 1024).toFixed(1) : 0
            },
            network: networkActivity,
            services: {
                apache: serviceStatus
            },
            top_processes_cpu: topProcessesCpu,
            top_processes_memory: topProcessesMem,
            system: {
                sessions: currentSessions,
                processes: processes.all,
                file_handles: `${fileHandles} / ${fileHandlesLimit}`,
                connections: activeConnections
            }
        };
    } catch (error) {
        console.error('Error collecting system metrics:', error);
        throw error;
    }
}

// Helper functions
function formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    let result = '';
    if (days > 0) result += `${days} day${days > 1 ? 's' : ''}, `;
    if (hours > 0) result += `${hours} hour${hours > 1 ? 's' : ''}, `;
    result += `${minutes} minute${minutes !== 1 ? 's' : ''}`;
    
    return result;
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function checkServiceStatus(serviceName) {
    return new Promise((resolve) => {
        exec(`systemctl is-active ${serviceName}`, (error, stdout) => {
            resolve(stdout.trim() || 'inactive');
        });
    });
}

// Function to get public IP address
async function getPublicIP() {
    return new Promise((resolve) => {
        const options = {
            hostname: 'api.ipify.org',
            path: '/',
            method: 'GET',
            timeout: 5000
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => {
                data += chunk;
            });
            res.on('end', () => {
                resolve(data.trim());
            });
        });

        req.on('error', () => {
            resolve('Unavailable');
        });

        req.on('timeout', () => {
            req.destroy();
            resolve('Unavailable');
        });

        req.end();
    });
}

// WebSocket connection for real-time updates
io.on('connection', (socket) => {
    console.log('Client connected');

    // Send metrics and historical data immediately when client connects
    getSystemMetrics().then(metrics => {
        socket.emit('metrics', metrics);
        socket.emit('historical', getHistoricalData(24));
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected');
    });
});

// Broadcast metrics to all connected clients every 10 seconds
setInterval(async () => {
    try {
        const metrics = await getSystemMetrics();
        io.emit('metrics', metrics);
    } catch (error) {
        console.error('Error broadcasting metrics:', error);
    }
}, 10000);

// Collect historical data every 30 seconds
setInterval(async () => {
    try {
        const metrics = await getSystemMetrics();
        addToHistory(metrics);
        io.emit('historical', getHistoricalData(24));
        console.log(`Historical data collected. Total points: ${metricsHistory.length}`);
    } catch (error) {
        console.error('Error collecting historical data:', error);
    }
}, DATA_COLLECTION_INTERVAL);

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`System Monitor Dashboard running on http://localhost:${PORT}`);
});
