export interface ParsedSatJoinUrl {
  origin: string;
  joinUrl: string;
  accessLinkId: string;
}

export function parseSatJoinUrl(input: string): ParsedSatJoinUrl {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('SAT_JOIN_URL is required.');
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`Invalid SAT_JOIN_URL: ${input}`);
  }

  const parts = url.pathname.split('/').filter(Boolean);
  // /join/:accessLinkId (from studentJoinUrl in accessLinkUi.ts)
  if (parts.length < 2 || parts[0] !== 'join') {
    throw new Error(`SAT_JOIN_URL must match /join/{accessLinkId}. Received: ${url.pathname}`);
  }

  const accessLinkId = decodeURIComponent(parts[1]);
  if (!accessLinkId) {
    throw new Error('Missing accessLinkId in SAT_JOIN_URL.');
  }

  return {
    origin: url.origin,
    joinUrl: url.toString(),
    accessLinkId,
  };
}
