// Phase 72e-1: reader feedback routes (curated communities). GET is guest-readable;
// every write requires auth. Create and reply are rate-limited per user.
const express = require('express');
const router = express.Router();
const feedbackController = require('../controllers/feedbackController');
const authenticateToken = require('../middleware/auth');
const { optionalAuth } = require('../middleware/auth');
const { feedbackCreateLimiter } = require('../utils/userRateLimiter');

// Read one card's feedback (guest-accessible).
router.get('/edge/:edgeId', optionalAuth, feedbackController.getFeedbackForEdge);

// Create / edit / delete an item.
router.post('/', authenticateToken, feedbackCreateLimiter, feedbackController.createFeedback);
router.post('/:id/edit', authenticateToken, feedbackController.editFeedback);
router.post('/:id/delete', authenticateToken, feedbackController.deleteFeedback);

// Vote toggle.
router.post('/:id/vote', authenticateToken, feedbackController.voteFeedback);

// Owner actions on an item.
router.post('/:id/status', authenticateToken, feedbackController.setStatus);
router.post('/:id/hide', authenticateToken, feedbackController.hideFeedback);

// Replies (literal /replies/* routes are registered before /:id/replies is fine —
// Express distinguishes them by the static 'replies' segment).
router.post('/:id/replies', authenticateToken, feedbackCreateLimiter, feedbackController.addReply);
router.post('/replies/:replyId/edit', authenticateToken, feedbackController.editReply);
router.post('/replies/:replyId/delete', authenticateToken, feedbackController.deleteReply);
router.post('/replies/:replyId/hide', authenticateToken, feedbackController.hideReply);

module.exports = router;
