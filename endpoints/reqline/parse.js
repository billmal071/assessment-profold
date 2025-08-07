const { createHandler } = require('@app-core/server');
const axios = require('axios');

function parseReqline(reqline) {
  const parts = reqline.split(' | ');

  if (parts.length < 2) {
    throw new Error('Invalid reqline format. Expected at least HTTP and URL parts.');
  }

  const result = {
    method: null,
    url: null,
    headers: {},
    query: {},
    body: {},
  };

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].trim();

    if (i === 0) {
      if (!part.startsWith('HTTP ')) {
        throw new Error('Missing required HTTP keyword');
      }

      const methodPart = part.substring(5).trim();
      if (!methodPart) {
        throw new Error('Missing HTTP method');
      }

      if (methodPart !== 'GET' && methodPart !== 'POST') {
        throw new Error('Invalid HTTP method. Only GET and POST are supported');
      }

      result.method = methodPart;
    } else if (i === 1) {
      if (!part.startsWith('URL ')) {
        throw new Error('Missing required URL keyword');
      }

      const urlPart = part.substring(4).trim();
      if (!urlPart) {
        throw new Error('Missing URL value');
      }

      if (!urlPart.startsWith('http://') && !urlPart.startsWith('https://')) {
        throw new Error('Invalid URL format. Must start with http:// or https://');
      }

      const urlParts = urlPart.split('/');
      if (urlParts.length < 3) {
        throw new Error('Invalid URL format. Missing domain or path');
      }

      result.url = urlPart;
    } else if (part.startsWith('HEADERS ')) {
      // Parse optional parts (HEADERS, QUERY, BODY)
      const headersPart = part.substring(8).trim();
      if (headersPart) {
        try {
          result.headers = JSON.parse(headersPart);
        } catch (error) {
          throw new Error('Invalid JSON format in HEADERS section');
        }
      }
    } else if (part.startsWith('QUERY ')) {
      const queryPart = part.substring(6).trim();
      if (queryPart) {
        try {
          result.query = JSON.parse(queryPart);
        } catch (error) {
          throw new Error('Invalid JSON format in QUERY section');
        }
      }
    } else if (part.startsWith('BODY ')) {
      const bodyPart = part.substring(5).trim();
      if (bodyPart) {
        try {
          result.body = JSON.parse(bodyPart);
        } catch (error) {
          throw new Error('Invalid JSON format in BODY section');
        }
      }
    } else {
      throw new Error(`Unknown keyword: ${part.split(' ')[0]}`);
    }
  }

  if (!result.method) {
    throw new Error('Missing required HTTP keyword');
  }

  if (!result.url) {
    throw new Error('Missing required URL keyword');
  }

  return result;
}

// Build full URL with query parameters
function buildFullUrl(baseUrl, queryParams) {
  if (!queryParams || Object.keys(queryParams).length === 0) {
    return baseUrl;
  }

  const separator = baseUrl.includes('?') ? '&' : '?';
  const queryString = Object.entries(queryParams)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');

  return `${baseUrl}${separator}${queryString}`;
}

module.exports = createHandler({
  path: '/',
  method: 'post',
  async handler(rc, helpers) {
    try {
      const { reqline } = rc.body;

      if (!reqline) {
        return {
          status: helpers.http_statuses.HTTP_400_BAD_REQUEST,
          data: {
            error: true,
            message: 'Missing reqline parameter',
          },
        };
      }

      const parsed = parseReqline(reqline);

      const fullUrl = buildFullUrl(parsed.url, parsed.query);

      const requestConfig = {
        method: parsed.method.toLowerCase(),
        url: fullUrl,
        headers: parsed.headers,
        timeout: 10000,
      };

      if (parsed.method === 'POST' && Object.keys(parsed.body).length > 0) {
        requestConfig.data = parsed.body;
      }

      const requestStartTimestamp = Date.now();
      const response = await axios(requestConfig);
      const requestStopTimestamp = Date.now();

      const duration = requestStopTimestamp - requestStartTimestamp;

      return {
        status: helpers.http_statuses.HTTP_200_OK,
        data: {
          request: {
            query: parsed.query,
            body: parsed.body,
            headers: parsed.headers,
            full_url: fullUrl,
          },
          response: {
            http_status: response.status,
            duration,
            request_start_timestamp: requestStartTimestamp,
            request_stop_timestamp: requestStopTimestamp,
            response_data: response.data,
          },
        },
      };
    } catch (error) {
      if (
        error.message.includes('Invalid reqline format') ||
        error.message.includes('Missing required') ||
        error.message.includes('Invalid HTTP method') ||
        error.message.includes('Invalid JSON format') ||
        error.message.includes('Unknown keyword')
      ) {
        return {
          status: helpers.http_statuses.HTTP_400_BAD_REQUEST,
          data: {
            error: true,
            message: error.message,
          },
        };
      }

      if (error.response) {
        return {
          status: helpers.http_statuses.HTTP_400_BAD_REQUEST,
          data: {
            error: true,
            message: `HTTP request failed: ${error.response.status} ${error.response.statusText}`,
          },
        };
      }

      return {
        status: helpers.http_statuses.HTTP_400_BAD_REQUEST,
        data: {
          error: true,
          message: `Network error: ${error.message}`,
        },
      };
    }
  },
});
