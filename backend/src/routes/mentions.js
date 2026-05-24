const express = require('express');
const router = express.Router();
const mentionsController = require('../controllers/mentionsController');

// GET /api/mentions/:targetType/:targetId — guest-accessible
router.get('/:targetType/:targetId', mentionsController.getMentions);

module.exports = router;
