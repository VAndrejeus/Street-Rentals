const { rentalsApi } = require("../../server");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: corsHeaders(),
      body: ""
    };
  }

  const requestUrl = new URL(event.rawUrl || `https://street-rentals.netlify.app${event.path}`);
  if (event.queryStringParameters) {
    Object.entries(event.queryStringParameters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && !requestUrl.searchParams.has(key)) {
        requestUrl.searchParams.set(key, value);
      }
    });
  }

  return captureResponse((res) => rentalsApi(requestUrl, res));
};

function captureResponse(run) {
  return new Promise((resolve) => {
    const response = {
      statusCode: 200,
      headers: corsHeaders(),
      body: ""
    };
    const res = {
      writeHead(statusCode, headers = {}) {
        response.statusCode = statusCode;
        response.headers = { ...response.headers, ...headers };
      },
      end(body = "") {
        response.body = Buffer.isBuffer(body) ? body.toString("utf8") : String(body);
        resolve(response);
      }
    };
    run(res);
  });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}
