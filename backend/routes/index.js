const express = require('express');
const rentalPriceCheck = require('./rentalPriceCheck');
const suburbFinder = require('./suburbFinder');

const router = express.Router();

router.use(rentalPriceCheck);
router.use(suburbFinder);

module.exports = router;
