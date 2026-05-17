const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/auth');
const optionalAuth = authenticateToken.optionalAuth;
const tunnelController = require('../controllers/tunnelController');

// Get tunnel links for an edge (guest-accessible)
router.get('/:edgeId', optionalAuth, tunnelController.getTunnelLinks);

// Create a tunnel link (auth required)
router.post('/create', authenticateToken, tunnelController.createTunnelLink);

// Toggle vote on a tunnel link (auth required)
router.post('/vote', authenticateToken, tunnelController.toggleTunnelVote);

// Add an addendum to a tunnel link (auth required — author only)
router.post('/:tunnelLinkId/addenda', authenticateToken, tunnelController.addTunnelLinkAddendum);

module.exports = router;
