module.exports = async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "Only GET requests are supported." });
    return;
  }

  const countryCode = String(request.query.countryCode || "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(countryCode)) {
    response.status(400).json({ error: "A valid two-letter country code is required." });
    return;
  }
  const city = String(request.query.city || "").trim().slice(0, 100);

  const apiKey = process.env.TICKETMASTER_API_KEY;
  if (!apiKey) {
    response.status(503).json({
      error: "Live events are not configured. Set TICKETMASTER_API_KEY in the deployment environment."
    });
    return;
  }

  const params = new URLSearchParams({
    apikey: apiKey,
    countryCode,
    size: "20",
    sort: "date,asc",
    ...(city ? { city } : {})
  });

  try {
    const upstream = await fetch(`https://app.ticketmaster.com/discovery/v2/events.json?${params}`);
    const body = await upstream.json();
    if (!upstream.ok) {
      const message = body.fault?.faultstring || `Ticketmaster returned ${upstream.status}.`;
      response.status(upstream.status).json({ error: message });
      return;
    }

    response.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
    response.status(200).json(body);
  } catch {
    response.status(502).json({ error: "The live events service could not be reached." });
  }
};
