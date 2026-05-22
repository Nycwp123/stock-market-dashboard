// State Management
const state = {
    currentSymbol: 'AAPL',
    currentRange: '1mo',
    chart: null,
    data: {}
};

// Popular stocks for suggestions
const popularStocks = [
    'AAPL', 'GOOGL', 'MSFT', 'TSLA', 'AMZN',
    'NVDA', 'META', 'NFLX', 'NVIDIA', 'ADOBE',
    'INTC', 'AMD', 'QUALCOMM', 'BROADCOM', 'ASML'
];

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    initializeEventListeners();
    loadStockData('AAPL');
});

// Event Listeners
function initializeEventListeners() {
    // Stock tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            loadStockData(e.target.dataset.symbol);
        });
    });

    // Time range buttons
    document.querySelectorAll('.range-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            state.currentRange = e.target.dataset.range;
            loadChartData(state.currentSymbol);
        });
    });

    // Search functionality
    document.getElementById('searchBtn').addEventListener('click', handleSearch);
    document.getElementById('symbolInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleSearch();
    });

    // Suggestions
    document.getElementById('symbolInput').addEventListener('input', handleSuggestions);
}

// Handle Search
function handleSearch() {
    const input = document.getElementById('symbolInput');
    const symbol = input.value.trim().toUpperCase();
    
    if (symbol && symbol.length <= 5) {
        loadStockData(symbol);
        input.value = '';
        document.getElementById('suggestions').classList.remove('show');
    }
}

// Handle Suggestions
function handleSuggestions(e) {
    const query = e.target.value.trim().toUpperCase();
    const suggestionsDiv = document.getElementById('suggestions');
    
    if (!query) {
        suggestionsDiv.classList.remove('show');
        return;
    }

    const filtered = popularStocks.filter(stock => 
        stock.startsWith(query)
    ).slice(0, 5);

    if (filtered.length === 0) {
        suggestionsDiv.classList.remove('show');
        return;
    }

    suggestionsDiv.innerHTML = filtered
        .map(stock => `<div class="suggestion-item" onclick="selectSuggestion('${stock}')">${stock}</div>`)
        .join('');
    suggestionsDiv.classList.add('show');
}

// Select suggestion
function selectSuggestion(symbol) {
    document.getElementById('symbolInput').value = '';
    document.getElementById('suggestions').classList.remove('show');
    loadStockData(symbol);
}

// Load Stock Data
async function loadStockData(symbol) {
    try {
        state.currentSymbol = symbol;

        // Update active tab
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.symbol === symbol);
        });

        // Show loading state
        showLoading();

        // Fetch quote and historical data
        const [quoteData, historyData, newsData] = await Promise.all([
            fetch(`/api/quote/${symbol}`).then(r => r.json()),
            fetch(`/api/history/${symbol}?range=${state.currentRange}`).then(r => r.json()),
            fetch(`/api/news/${symbol}`).then(r => r.json())
        ]);

        state.data[symbol] = {
            quote: quoteData,
            history: historyData
        };

        // Update UI
        updateStockInfo(quoteData);
        updateChart(historyData);
        updateNews(newsData);
        hideLoading();

    } catch (error) {
        console.error('Error loading stock data:', error);
        showError('Failed to load stock data. Please try again.');
    }
}

// Load Chart Data
async function loadChartData(symbol) {
    try {
        showLoading();
        const historyData = await fetch(`/api/history/${symbol}?range=${state.currentRange}`)
            .then(r => r.json());

        if (state.data[symbol]) {
            state.data[symbol].history = historyData;
        }

        updateChart(historyData);
        hideLoading();

    } catch (error) {
        console.error('Error loading chart data:', error);
        showError('Failed to load chart data.');
    }
}

// Update Stock Info
function updateStockInfo(quoteData) {
    const price = quoteData.price;
    
    document.getElementById('stockSymbol').textContent = price.symbol;
    document.getElementById('currentPrice').textContent = `$${price.currentPrice.toFixed(2)}`;

    const change = price.regularMarketChange;
    const changePercent = price.regularMarketChangePercent;
    const changeElement = document.getElementById('priceChange');
    
    changeElement.textContent = `${change >= 0 ? '+' : ''}${change.toFixed(2)} (${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(2)}%)`;
    changeElement.className = change >= 0 ? 'change positive' : 'change negative';

    // Summary data
    const summary = quoteData.summaryDetail;
    document.getElementById('high52w').textContent = summary.fiftyTwoWeekHigh?.fmt || '-';
    document.getElementById('low52w').textContent = summary.fiftyTwoWeekLow?.fmt || '-';
    document.getElementById('marketCap').textContent = summary.marketCap?.longFmt || '-';
}

// Update Chart
function updateChart(historyData) {
    if (!historyData || historyData.length === 0) {
        showError('No chart data available');
        return;
    }

    // Sort by date
    historyData.sort((a, b) => a.timestamp - b.timestamp);

    const ctx = document.getElementById('stockChart').getContext('2d');
    
    // Destroy existing chart
    if (state.chart) {
        state.chart.destroy();
    }

    // Format data
    const labels = historyData.map(d => new Date(d.date));
    const prices = historyData.map(d => d.close);
    const ma20 = historyData.map(d => d.ma20);
    const ma50 = historyData.map(d => d.ma50);
    const volumes = historyData.map(d => d.volume);

    // Create chart
    state.chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Close Price',
                    data: prices,
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 0,
                    pointHoverRadius: 6,
                    yAxisID: 'y'
                },
                {
                    label: 'MA 20',
                    data: ma20,
                    borderColor: '#f59e0b',
                    borderWidth: 1.5,
                    fill: false,
                    tension: 0.4,
                    pointRadius: 0,
                    borderDash: [5, 5],
                    yAxisID: 'y'
                },
                {
                    label: 'MA 50',
                    data: ma50,
                    borderColor: '#ef4444',
                    borderWidth: 1.5,
                    fill: false,
                    tension: 0.4,
                    pointRadius: 0,
                    borderDash: [5, 5],
                    yAxisID: 'y'
                },
                {
                    label: 'Volume',
                    data: volumes,
                    type: 'bar',
                    backgroundColor: 'rgba(99, 102, 241, 0.2)',
                    borderColor: 'transparent',
                    yAxisID: 'y1'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    labels: {
                        padding: 15,
                        font: { size: 12, weight: '600' },
                        usePointStyle: true
                    }
                },
                tooltip: {
                    enabled: true,
                    mode: 'index',
                    intersect: false,
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    padding: 12,
                    titleFont: { size: 14, weight: 'bold' },
                    bodyFont: { size: 13 },
                    callbacks: {
                        title: function(context) {
                            return formatDate(context[0].label);
                        },
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            
                            if (context.parsed.y !== null) {
                                if (label.includes('Volume')) {
                                    label += formatVolume(context.parsed.y);
                                } else {
                                    label += '$' + context.parsed.y.toFixed(2);
                                }
                            }
                            return label;
                        },
                        afterLabel: function(context) {
                            if (context.datasetIndex === 0) {
                                // Show RSI for close price
                                const dataIndex = context.dataIndex;
                                const rsi = historyData[dataIndex]?.rsi;
                                if (rsi !== null && rsi !== undefined) {
                                    return `RSI: ${rsi.toFixed(2)}`;
                                }
                            }
                        }
                    }
                }
            },
            scales: {
                x: {
                    type: 'time',
                    time: {
                        displayFormats: {
                            day: 'MMM dd',
                            hour: 'HH:mm'
                        }
                    },
                    grid: {
                        display: false
                    }
                },
                y: {
                    type: 'linear',
                    position: 'left',
                    title: {
                        display: true,
                        text: 'Price ($)',
                        font: { size: 12, weight: '600' }
                    },
                    grid: {
                        color: 'rgba(0, 0, 0, 0.05)'
                    }
                },
                y1: {
                    type: 'linear',
                    position: 'right',
                    title: {
                        display: true,
                        text: 'Volume',
                        font: { size: 12, weight: '600' }
                    },
                    grid: {
                        display: false
                    }
                }
            }
        }
    });

    // Update indicators
    const lastData = historyData[historyData.length - 1];
    document.getElementById('ma20').textContent = lastData.ma20 ? `$${lastData.ma20.toFixed(2)}` : '-';
    document.getElementById('ma50').textContent = lastData.ma50 ? `$${lastData.ma50.toFixed(2)}` : '-';
    document.getElementById('rsi').textContent = lastData.rsi ? `${lastData.rsi.toFixed(2)}` : '-';
    document.getElementById('volume').textContent = formatVolume(lastData.volume);
}

// Update News
function updateNews(news) {
    const newsContainer = document.getElementById('newsContainer');
    
    if (!news || news.length === 0) {
        newsContainer.innerHTML = '<p class="loading">No news available</p>';
        return;
    }

    newsContainer.innerHTML = news.slice(0, 6).map(item => `
        <div class="news-card">
            <h4>${item.title}</h4>
            <p>${item.link || ''}</p>
            <div class="source">
                <span>${formatTimeAgo(item.providerPublishTime)}</span>
                <a href="${item.link}" target="_blank" rel="noopener">Read More →</a>
            </div>
        </div>
    `).join('');
}

// Utility Functions
function formatDate(date) {
    const d = new Date(date);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTimeAgo(timestamp) {
    const now = Math.floor(Date.now() / 1000);
    const seconds = now - timestamp;
    
    if (seconds < 60) return 'Just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

function formatVolume(volume) {
    if (volume >= 1e9) return (volume / 1e9).toFixed(2) + 'B';
    if (volume >= 1e6) return (volume / 1e6).toFixed(2) + 'M';
    if (volume >= 1e3) return (volume / 1e3).toFixed(2) + 'K';
    return volume.toString();
}

function showLoading() {
    // Add loading indicator if needed
}

function hideLoading() {
    // Remove loading indicator
}

function showError(message) {
    console.error(message);
    // You can add a toast notification here
}
