const express = require('express');
const rentalPriceCheck = require('./rentalPriceCheck');
const suburbFinder = require('./suburbFinder');
const suburbs = require('./suburbs');

const router = express.Router();

router.use(rentalPriceCheck);
router.use(suburbFinder);
router.use(suburbs);

module.exports = router;
