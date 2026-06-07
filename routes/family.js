const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const {
  createFamilyLink,
  addPersonToFamily,
  getFamilyMembers,
} = require('../controllers/familyController');

router.post('/create-family-link', auth, createFamilyLink);
router.post('/:familyKey/add-person', auth, addPersonToFamily);
router.get('/:familyKey/members', auth, getFamilyMembers);

module.exports = router;
