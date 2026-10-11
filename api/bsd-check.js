// Safe diagnostic for BSD_API_KEY. Never returns the token itself.
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const key = process.env.BSD_API_KEY;
  if (!key) {
    res.status(503).json({
      ok: false,
      step: 'missing_key',
      message: 'BSD_API_KEY non è presente nelle variabili ambiente di questa deployment. Controlla Production e poi fai Redeploy.'
    });
    return;
  }
  try {
    const url = 'https://sports.bzzoiro.com/api/v2/events/?date_from=' +
      new Date().toISOString().slice(0, 10) + '&date_to=' +
      new Date().toISOString().slice(0, 10) + '&status=upcoming&limit=5';
    const r = await fetch(url, {
      headers: { Authorization: 'Token ' + key },
      signal: AbortSignal.timeout(10000)
    });
    const body = await r.json();
    if (!r.ok) {
      res.status(200).json({
        ok: false,
        step: r.status === 401 ? 'invalid_key' : r.status === 402 ? 'paid_access' : r.status === 429 ? 'rate_limit' : 'provider_error',
        providerStatus: r.status,
        message: r.status === 401 ? 'BSD non accetta la chiave: controlla di aver verificato la mail e copiato il token corretto.' :
          r.status === 402 ? 'BSD richiede un add-on a pagamento per questa risorsa.' :
          r.status === 429 ? 'BSD ha restituito un limite di richieste.' : 'BSD ha restituito un errore.',
        details: body && (body.detail || body.error || body.message) || null
      });
      return;
    }
    const rows = Array.isArray(body) ? body : (Array.isArray(body.results) ? body.results : []);
    res.status(200).json({
      ok: true,
      step: 'authenticated',
      provider: 'BSD',
      eventsReturned: rows.length,
      sample: rows.slice(0, 3).map(e => ({
        id: e.id || e.event_id || null,
        date: e.event_date || e.date || null,
        home: e.home_team_name || e.home_team?.name || e.home || null,
        away: e.away_team_name || e.away_team?.name || e.away || null,
        league: e.league_name || e.league?.name || e.competition || null
      })),
      message: 'Chiave valida. Questo controllo verifica l’accesso ai dati delle partite; non modifica ancora il radar.'
    });
  } catch (e) {
    res.status(200).json({
      ok: false,
      step: 'network_error',
      message: 'La richiesta a BSD non è riuscita.',
      details: String(e && e.message || e)
    });
  }
};
