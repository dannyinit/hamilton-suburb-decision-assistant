const express = require('express');
const rentalPriceCheck = require('./rentalPriceCheck');

const router = express.Router();

router.use(rentalPriceCheck);

module.exports = router;
