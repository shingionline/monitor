// Initialize socket connection
const socket = io();

// Chart instances
let cpuChart = null;
let ramChart = null;
let diskChart = null;
let countdown = 10;
let countdownInterval = null;

// Historical data storage
let historicalData = [];

// Initialize dashboard
document.addEventListener('DOMContentLoaded', function() {
    initializeTabs();
    initializeCharts();
    startCountdown();
});

// Socket event listeners
socket.on('connect', function() {
    console.log('Connected to server');
});

socket.on('metrics', function(data) {
    updateDashboard(data);
    resetCountdown();
});

socket.on('historical', function(data) {
    historicalData = data;
    updateHistoricalCharts();
});

socket.on('disconnect', function() {
    console.log('Disconnected from server');
});

// Tab functionality
function initializeTabs() {
    const tabs = document.querySelectorAll('.nav-tab');
    const contents = document.querySelectorAll('.tab-content');

    tabs.forEach(tab => {
        tab.addEventListener('click', function() {
            const targetTab = this.getAttribute('data-tab');
            
            // Update active tab
            tabs.forEach(t => t.classList.remove('active'));
            this.classList.add('active');
            
            // Show corresponding content
            contents.forEach(content => {
                if (content.id === targetTab) {
                    content.classList.remove('hidden');
                } else {
                    content.classList.add('hidden');
                }
            });
        });
    });
}

// Initialize charts
function initializeCharts() {
    // Common chart configuration
    const commonOptions = {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
            x: {
                display: true,
                grid: {
                    color: '#3a3f4b'
                },
                ticks: {
                    color: '#8b949e',
                    maxTicksLimit: 8
                }
            },
            y: {
                display: true,
                min: 0,
                max: 100,
                grid: {
                    color: '#3a3f4b'
                },
                ticks: {
                    color: '#8b949e',
                    callback: function(value) {
                        return value + '%';
                    }
                }
            }
        },
        plugins: {
            legend: {
                display: false
            }
        },
        elements: {
            point: {
                radius: 0
            }
        }
    };

    // CPU Chart
    const cpuCtx = document.getElementById('cpu-chart');
    if (cpuCtx) {
        cpuChart = new Chart(cpuCtx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'CPU Usage %',
                    data: [],
                    borderColor: '#58a6ff',
                    backgroundColor: 'rgba(88, 166, 255, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4
                }]
            },
            options: commonOptions
        });
    }
    
    // RAM Chart
    const ramCtx = document.getElementById('ram-chart');
    if (ramCtx) {
        ramChart = new Chart(ramCtx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'Memory Usage %',
                    data: [],
                    borderColor: '#f78166',
                    backgroundColor: 'rgba(247, 129, 102, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4
                }]
            },
            options: commonOptions
        });
    }

    // Disk Chart
    const diskCtx = document.getElementById('disk-chart');
    if (diskCtx) {
        diskChart = new Chart(diskCtx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'Disk Usage %',
                    data: [],
                    borderColor: '#56d364',
                    backgroundColor: 'rgba(86, 211, 100, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4
                }]
            },
            options: commonOptions
        });
    }
}

// Update dashboard with new metrics
function updateDashboard(metrics) {
    try {
        // Update system info cards (with safety checks for removed elements)
        const updateElement = (id, value) => {
            const element = document.getElementById(id);
            if (element) element.textContent = value;
        };
        
        // Update hostname info card  
        updateElement('hostname', metrics.metadata.hostname);
        
        // Update system date with formatted time
        const now = new Date();
        const day = now.getDate();
        const month = now.toLocaleDateString('en-US', { month: 'long' });
        const year = now.getFullYear();
        const hours = now.getHours().toString().padStart(2, '0');
        const minutes = now.getMinutes().toString().padStart(2, '0');
        const formattedDate = `${day} ${month} ${year} ${hours}:${minutes}`;
        updateElement('system-date', formattedDate);
        
        updateElement('uptime', metrics.metadata.uptime);
        updateElement('cpu-model', metrics.cpu.model);
        updateElement('operating-system', metrics.metadata.os);
        updateElement('cpu-speed', metrics.cpu.speed);
        updateElement('kernel', 'Linux');
        updateElement('file-handles', metrics.system.file_handles);
        updateElement('processes', metrics.system.processes);
        
        // Update network activity (with safety checks)
        if (metrics.network) {
            updateElement('network-incoming', metrics.network.incoming);
            updateElement('network-outgoing', metrics.network.outgoing);            // Enhanced network metrics\n            updateElement('network-interface', metrics.network.interface);\n            updateElement('network-rx-total', metrics.network.rx_total);\n            updateElement('network-tx-total', metrics.network.tx_total);\n            updateElement('active-connections', metrics.network.connections);
        }

        // Update CPU metrics
        const cpuUsage = parseFloat(metrics.cpu.usage_percent);
        document.getElementById('cpu-usage').textContent = cpuUsage.toFixed(1) + '%';
        // document.getElementById('load-averages').textContent = 
        //     `${metrics.cpu.load_1} ${metrics.cpu.load_5} ${metrics.cpu.load_15}`;

        // Update RAM metrics
        const ramUsedMB = metrics.memory.used_mb;
        const ramTotalGB = metrics.memory.total_gb;
        const ramUsedPercent = parseFloat(metrics.memory.used_percent);
        
        // Format RAM usage: show GB if over 1GB, otherwise MB
        const ramUsageDisplay = ramUsedMB >= 1024 
            ? `${(ramUsedMB / 1024).toFixed(1)} GB` 
            : `${ramUsedMB} MB`;
        document.getElementById('ram-usage').textContent = ramUsageDisplay;
        document.getElementById('ram-total').textContent = `/ ${ramTotalGB} GB`;
        document.getElementById('ram-progress').style.width = `${ramUsedPercent}%`;

        // Update Disk metrics
        const diskUsedGB = metrics.disk.used_gb;
        const diskTotalGB = metrics.disk.total_gb;
        const diskUsedPercent = parseFloat(metrics.disk.used_percent);
        
        document.getElementById('disk-usage').textContent = `${diskUsedGB} GB`;
        document.getElementById('disk-total').textContent = `/ ${diskTotalGB} GB`;
        document.getElementById('disk-progress').style.width = `${diskUsedPercent}%`;

        // Update process tables
        updateProcessTables(metrics.top_processes_cpu, metrics.top_processes_memory);

    } catch (error) {
        console.error('Error updating dashboard:', error);
    }
}

// Update historical charts with historical data
function updateHistoricalCharts() {
    if (!historicalData.length) return;

    // Prepare data for all charts
    const labels = historicalData.map(point => {
        const date = new Date(point.timestamp);
        return date.toLocaleTimeString('en-US', { 
            hour: '2-digit', 
            minute: '2-digit',
            hour12: false 
        });
    });
    
    const cpuData = historicalData.map(point => point.cpu);
    const memoryData = historicalData.map(point => point.memory);
    const diskData = historicalData.map(point => point.disk);

    // Update CPU chart
    if (cpuChart && historicalData.length > 0) {
        cpuChart.data.labels = labels;
        cpuChart.data.datasets[0].data = cpuData;
        cpuChart.update('none');
        updateChartNote('cpu', historicalData.length);
    }

    // Update RAM chart
    if (ramChart && historicalData.length > 0) {
        ramChart.data.labels = labels;
        ramChart.data.datasets[0].data = memoryData;
        ramChart.update('none');
        updateChartNote('ram', historicalData.length);
    }

    // Update Disk chart
    if (diskChart && historicalData.length > 0) {
        diskChart.data.labels = labels;
        diskChart.data.datasets[0].data = diskData;
        diskChart.update('none');
        updateChartNote('disk', historicalData.length);
    }
}

// Update chart note based on data availability
function updateChartNote(chartType, dataPoints) {
    let noteElement;
    let chartContainer;
    
    if (chartType === 'cpu') {
        chartContainer = document.getElementById('cpu-chart').closest('.metric-card');
    } else if (chartType === 'ram') {
        chartContainer = document.getElementById('ram-chart').closest('.metric-card');
    } else if (chartType === 'disk') {
        chartContainer = document.getElementById('disk-chart').closest('.metric-card');
    }
    
    if (chartContainer) {
        noteElement = chartContainer.querySelector('.chart-note');
    }
    
    if (noteElement) {
        if (dataPoints > 0) {
            const hours = Math.floor(dataPoints * 30 / 3600); // 30 seconds per data point
            const minutes = Math.floor((dataPoints * 30 % 3600) / 60);
            let timeText = '';
            if (hours > 0) timeText += `${hours}h `;
            if (minutes > 0) timeText += `${minutes}m`;
            if (!timeText) timeText = '< 1m';
            
            // Calculate percentage of 24-hour coverage
            const maxPoints = 2880; // 24 hours worth
            const coverage = Math.min(100, (dataPoints / maxPoints) * 100);
            
            noteElement.textContent = `${dataPoints} data points • ${timeText} of 24h history (${coverage.toFixed(0)}% complete)`;
            noteElement.style.color = '#58a6ff';
        } else {
            noteElement.textContent = 'No historical data available yet';
            noteElement.style.color = '#8b949e';
        }
    }
}

// Update process tables
function updateProcessTables(cpuProcesses, memoryProcesses) {
    // Update CPU processes
    const cpuContainer = document.getElementById('cpu-processes');
    cpuContainer.innerHTML = '';
    
    cpuProcesses.forEach(process => {
        const processItem = document.createElement('div');
        processItem.className = 'process-item';
        processItem.innerHTML = `
            <span class="process-name">${process.name}</span>
            <span>${process.cpu}%</span>
            <span>${process.mem}%</span>
        `;
        cpuContainer.appendChild(processItem);
    });

    // Update Memory processes
    const memContainer = document.getElementById('memory-processes');
    memContainer.innerHTML = '';
    
    memoryProcesses.forEach(process => {
        const processItem = document.createElement('div');
        processItem.className = 'process-item';
        processItem.innerHTML = `
            <span class="process-name">${process.name}</span>
            <span>${process.cpu}%</span>
            <span>${process.mem}%</span>
        `;
        memContainer.appendChild(processItem);
    });
}

// Countdown timer
function startCountdown() {
    countdownInterval = setInterval(() => {
        countdown--;
        document.getElementById('countdown').textContent = countdown;
        
        if (countdown <= 0) {
            countdown = 10;
        }
    }, 1000);
}

function resetCountdown() {
    countdown = 10;
    document.getElementById('countdown').textContent = countdown;
}

// Utility functions
function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

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

// Error handling
window.addEventListener('error', function(e) {
    console.error('JavaScript error:', e.error);
});

// Handle page visibility changes to manage updates
document.addEventListener('visibilitychange', function() {
    if (document.hidden) {
        // Page is hidden, you might want to reduce update frequency
        console.log('Page is hidden');
    } else {
        // Page is visible, resume normal updates
        console.log('Page is visible');
    }
});