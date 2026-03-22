const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const si = require('systeminformation');
const os = require('os');
const { exec } = require('child_process');
const fs = require('fs');

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

        // Memory info
        const mem = await si.mem();
        const memUsedPercent = ((mem.used / mem.total) * 100).toFixed(1);

        // Disk usage
        const fsSize = await si.fsSize();
        const rootFs = fsSize.find(fs => fs.mount === '/') || fsSize[0];
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

        // Network info
        const networkStats = await si.networkStats();
        const networkActivity = {
            incoming: formatBytes(networkStats[0]?.rx_sec || 0) + '/s',
            outgoing: formatBytes(networkStats[0]?.tx_sec || 0) + '/s'
        };

        // Service status (Apache)
        const serviceStatus = await checkServiceStatus('apache2');

        return {
            metadata: {
                hostname,
                os: `${osInfo.distro} ${osInfo.release}`,
                uptime,
                reported_at: currentTime,
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
            },
            cpu: {
                usage_percent: currentLoad.currentLoad.toFixed(1),
                model: cpuInfo.manufacturer + ' ' + cpuInfo.brand,
                speed: cpuInfo.speed ? `${cpuInfo.speed} GHz` : 'Unknown',
                cores: cpuInfo.cores,
                load_1: loadAvg[0].toFixed(2),
                load_5: loadAvg[1].toFixed(2),
                load_15: loadAvg[2].toFixed(2)
            },
            memory: {
                used_percent: memUsedPercent,
                total_mb: Math.round(mem.total / 1024 / 1024),
                used_mb: Math.round(mem.used / 1024 / 1024),
                available_mb: Math.round(mem.available / 1024 / 1024),
                total_gb: (mem.total / 1024 / 1024 / 1024).toFixed(1)
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
                sessions: 1, // Simplified
                processes: processes.all,
                file_handles: '448 of 57285' // Simplified
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`System Monitor Dashboard running on http://localhost:${PORT}`);
});