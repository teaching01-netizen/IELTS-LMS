import { check, sleep } from 'k6';

const MAX_RETRY_AFTER_SECONDS = 3600;

function parseCanonicalInteger(value) {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 1 && value <= MAX_RETRY_AFTER_SECONDS ? value : null;
  }

  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value.trim())) {
    return null;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= MAX_RETRY_AFTER_SECONDS ? parsed : null;
}

function responseDetails(response) {
  let body = null;
  try {
    body = response.json();
  } catch (_) {
    body = null;
  }

  const rootDetails = body && typeof body.details === 'object' ? body.details : null;
  const errorDetails = body && body.error && typeof body.error.details === 'object' ? body.error.details : null;
  return rootDetails || errorDetails || {};
}

export function inspectRateLimitResponse(response) {
  const headers = (response && response.headers) || {};
  const headerValue = headers['Retry-After'] || headers['retry-after'] || headers['Retry-after'];
  const details = responseDetails(response);
  const headerSeconds = parseCanonicalInteger(headerValue);
  const bodySeconds = parseCanonicalInteger(details.retryAfterSeconds);

  return {
    headerSeconds,
    bodySeconds,
    retryAfterSeconds: headerSeconds || bodySeconds || 0,
    hasQueuePosition: Object.prototype.hasOwnProperty.call(details, 'queuePosition'),
  };
}

export function assertRateLimitContract(response, label) {
  const contract = inspectRateLimitResponse(response);
  const valid =
    response.status !== 429 ||
    check(response, {
      [`${label} Retry-After is canonical`]: () => contract.headerSeconds !== null,
      [`${label} details.retryAfterSeconds is canonical`]: () => contract.bodySeconds !== null,
      [`${label} has no queue position`]: () => !contract.hasQueuePosition,
    });

  return { ...contract, valid };
}

export function requestWithRateLimitRetry(requestFn, maxSeconds, label) {
  const startedAt = Date.now();
  let response = requestFn();
  let contract = null;

  while (response.status === 429 && (Date.now() - startedAt) / 1000 < maxSeconds) {
    contract = assertRateLimitContract(response, label);
    if (!contract.valid) {
      return { response, contract };
    }

    sleep(contract.retryAfterSeconds);
    response = requestFn();
  }

  if (response.status === 429) {
    contract = assertRateLimitContract(response, label);
  }

  return { response, contract };
}
