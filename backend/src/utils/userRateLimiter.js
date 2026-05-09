// Phase 49b — Per-user rate limiters for authenticated write endpoints.
const rateLimit = require('express-rate-limit');

const ONE_HOUR_MS = 60 * 60 * 1000;

function perUserHourly(max, label) {
  return rateLimit({
    windowMs: ONE_HOUR_MS,
    max,
    keyGenerator: (req) => `u:${req.user.userId}`,
    message: { error: `You are doing that too often. Please wait before trying again.${label ? ` (${label})` : ''}` },
    standardHeaders: true,
    legacyHeaders: false,
  });
}

module.exports = {
  perUserHourly,

  // Moderation — weaponizable for coordinated hiding (10 flags hides an edge)
  flagLimiter: perUserHourly(20, 'flag'),

  // Info page comments — public-facing spam target
  pageCommentLimiter: perUserHourly(10, 'page comment'),

  // Web link additions — attractive to link spammers
  webLinkAddLimiter: perUserHourly(30, 'web link add'),

  // Root concept creation — graph-level vandalism
  rootConceptCreateLimiter: perUserHourly(10, 'root concept create'),

  // Child concept creation — more generous budget (normal usage)
  childConceptCreateLimiter: perUserHourly(100, 'child concept create'),
};
