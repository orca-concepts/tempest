const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/auth');
const optionalAuth = authenticateToken.optionalAuth;
const comboController = require('../controllers/comboController');

// ---- Specific paths FIRST (before /:id) ----

router.get('/mine', authenticateToken, comboController.getMyCombos);
router.get('/subscriptions', authenticateToken, comboController.getComboSubscriptions);
router.post('/create', authenticateToken, comboController.createCombo);
router.post('/subscribe', authenticateToken, comboController.subscribeToCombo);
router.post('/unsubscribe', authenticateToken, comboController.unsubscribeFromCombo);
router.get('/by-edge/:edgeId', optionalAuth, comboController.getCombosByEdge);
router.get('/', optionalAuth, comboController.listCombos);

// ---- Parameterized routes ----

router.get('/:id', optionalAuth, comboController.getCombo);
router.get('/:id/links', optionalAuth, comboController.getComboLinks); // Phase 58b-2: aggregated links across member edges
router.post('/:id/edges/add', authenticateToken, comboController.addEdgeToCombo);
router.post('/:id/edges/remove', authenticateToken, comboController.removeEdgeFromCombo);
router.post('/:id/transfer-ownership', authenticateToken, comboController.transferOwnership);
router.post('/:id/vote', authenticateToken, comboController.toggleComboVote); // Phase 67: situation votes

module.exports = router;
