const axios = require('axios');
const pool = require('../config/db');

const normalizeCurrencyCode = (currency) => String(currency || '').trim().toUpperCase();

const getLiveExchangeRate = async (req, res) => {
    try {
        const currency = normalizeCurrencyCode(req.query.currency);

        if (!/^[A-Z]{3}$/.test(currency)) {
            return res.status(400).json({ success: false, message: 'Valid 3-letter currency code is required.' });
        }

        if (currency === 'USD') {
            return res.status(200).json({
                success: true,
                base: 'USD',
                currency,
                rate: 1,
                source: 'USD',
            });
        }

        const symbol = `USD${currency}=X`;
        const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1m`;
        const { data } = await axios.get(yahooUrl, { timeout: 8000 });
        const meta = data?.chart?.result?.[0]?.meta;
        const rate = Number(meta?.regularMarketPrice || meta?.previousClose);

        if (!rate || Number.isNaN(rate)) {
            return res.status(502).json({ success: false, message: `Live exchange rate unavailable for ${currency}.` });
        }

        return res.status(200).json({
            success: true,
            base: 'USD',
            currency,
            rate,
            source: 'Yahoo Finance live market quote',
            symbol,
            marketTime: meta?.regularMarketTime || null,
        });
    } catch (error) {
        console.error('LIVE EXCHANGE RATE ERROR:', error.message);
        return res.status(502).json({ success: false, message: 'Live exchange rate service is unavailable.' });
    }
};

// অ্যাডমিন প্যানেল থেকে ডায়নামিক ফি কনফিগারেশন সেভ বা আপডেট (UPSERT) করার ফাংশন
const upsertFeeConfig = async (req, res) => {
    try {
        let { 
            country, 
            platform, 
            platform_charge, 
            platform_charge_conditions = {},
            buyer_reward_conditions = {},
            buyer_reward = 0, 
            buyer_refund_fee = 0, 
            seller_deposit_fee = 0, 
            seller_withdrawal_fee = 0,
            exchange_rate = 1,
            verification_fields = []
        } = req.body;

        if (!country || !platform) {
            return res.status(400).json({ success: false, message: 'Country and Platform are required fields.' });
        }

        // 🔥 LOGIC: Ensure platform_charge is correctly formatted as a JSON string for database storage
        let processedPlatformCharge = platform_charge;
        if (typeof platform_charge === 'object') {
            processedPlatformCharge = JSON.stringify(platform_charge);
        } else if (!platform_charge) {
            // Default fallback if nothing is provided
            processedPlatformCharge = JSON.stringify([{ min: 0, max: 0, fee: 0 }]); 
        }

        let processedPlatformChargeConditions = platform_charge_conditions;
        if (typeof platform_charge_conditions === 'string') {
            try {
                processedPlatformChargeConditions = JSON.parse(platform_charge_conditions);
            } catch {
                processedPlatformChargeConditions = {};
            }
        }
        if (!processedPlatformChargeConditions || typeof processedPlatformChargeConditions !== 'object' || Array.isArray(processedPlatformChargeConditions)) {
            processedPlatformChargeConditions = {};
        }
        processedPlatformChargeConditions = JSON.stringify(processedPlatformChargeConditions);

        let processedBuyerRewardConditions = buyer_reward_conditions;
        if (typeof buyer_reward_conditions === 'string') {
            try {
                processedBuyerRewardConditions = JSON.parse(buyer_reward_conditions);
            } catch {
                processedBuyerRewardConditions = {};
            }
        }
        if (!processedBuyerRewardConditions || typeof processedBuyerRewardConditions !== 'object' || Array.isArray(processedBuyerRewardConditions)) {
            processedBuyerRewardConditions = {};
        }
        processedBuyerRewardConditions = JSON.stringify(processedBuyerRewardConditions);

        let processedVerificationFields = verification_fields;
        if (typeof verification_fields === 'object' && !Array.isArray(verification_fields)) {
            processedVerificationFields = [];
        } else if (Array.isArray(verification_fields)) {
            processedVerificationFields = JSON.stringify(verification_fields);
        } else if (typeof verification_fields === 'string') {
            processedVerificationFields = verification_fields;
        } else {
            processedVerificationFields = '[]';
        }

        // UPSERT Query with exchange_rate + verification_fields
        const query = `
            INSERT INTO dynamic_fees_config (
                country, platform, platform_charge, buyer_reward, 
                buyer_refund_fee, seller_deposit_fee, seller_withdrawal_fee, exchange_rate,
                platform_charge_conditions,
                buyer_reward_conditions,
                verification_fields
            ) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb)
            ON CONFLICT (country, platform) 
            DO UPDATE SET 
                platform_charge = EXCLUDED.platform_charge,
                buyer_reward = EXCLUDED.buyer_reward,
                buyer_refund_fee = EXCLUDED.buyer_refund_fee,
                seller_deposit_fee = EXCLUDED.seller_deposit_fee,
                seller_withdrawal_fee = EXCLUDED.seller_withdrawal_fee,
                exchange_rate = EXCLUDED.exchange_rate,
                platform_charge_conditions = EXCLUDED.platform_charge_conditions,
                buyer_reward_conditions = EXCLUDED.buyer_reward_conditions,
                verification_fields = EXCLUDED.verification_fields,
                updated_at = CURRENT_TIMESTAMP
            RETURNING *;
        `;

        const values = [
            country.trim(), 
            platform.trim(), 
            processedPlatformCharge, 
            buyer_reward,
            buyer_refund_fee, 
            seller_deposit_fee, 
            seller_withdrawal_fee,
            exchange_rate,
            processedPlatformChargeConditions,
            processedBuyerRewardConditions,
            processedVerificationFields
        ];

        let result;
        try {
            result = await pool.query(query, values);
        } catch (dbErr) {
            // Fallback when verification_fields column is not migrated yet
            const legacyQuery = `
            INSERT INTO dynamic_fees_config (
                country, platform, platform_charge, buyer_reward, 
                buyer_refund_fee, seller_deposit_fee, seller_withdrawal_fee, exchange_rate
            ) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (country, platform) 
            DO UPDATE SET 
                platform_charge = EXCLUDED.platform_charge,
                buyer_reward = EXCLUDED.buyer_reward,
                buyer_refund_fee = EXCLUDED.buyer_refund_fee,
                seller_deposit_fee = EXCLUDED.seller_deposit_fee,
                seller_withdrawal_fee = EXCLUDED.seller_withdrawal_fee,
                exchange_rate = EXCLUDED.exchange_rate,
                updated_at = CURRENT_TIMESTAMP
            RETURNING *;
        `;
            result = await pool.query(legacyQuery, values.slice(0, 8));

            if (Array.isArray(verification_fields) && verification_fields.length > 0) {
                try {
                    const { savePlatformFieldsToStore } = require('./verificationConfigController');
                    await savePlatformFieldsToStore(country, platform, verification_fields);
                } catch (innerErr) {
                    console.warn('Saved tariffs; platform verification fields stored separately.', innerErr.message);
                }
            }
        }

        return res.status(200).json({ 
            success: true, 
            message: 'Fee configuration saved/updated successfully.', 
            data: result.rows[0] 
        });

    } catch (error) {
        console.error('Error in upsertFeeConfig:', error);
        return res.status(500).json({ success: false, message: 'Internal server error while saving fee configuration.' });
    }
};

// ক্যালকুলেটরের জন্য নির্দিষ্ট দেশ এবং প্ল্যাটফর্ম অনুযায়ী ফি ডেটা ফেচ করার ফাংশন
const getFeeConfig = async (req, res) => {
    try {
        const { country, platform } = req.query;

        if (!country || !platform) {
            return res.status(400).json({ success: false, message: 'Please provide both country and platform.' });
        }

        const query = `SELECT * FROM dynamic_fees_config WHERE LOWER(country) = LOWER($1) AND LOWER(platform) = LOWER($2)`;
        const result = await pool.query(query, [country.trim(), platform.trim()]);

        if (result.rows.length === 0) {
            return res.status(200).json({ success: true, data: null, message: 'No configuration found.' });
        }

        return res.status(200).json({ success: true, data: result.rows[0] });

    } catch (error) {
        console.error('Error in getFeeConfig:', error);
        return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
};

// অ্যাডমিন প্যানেলের টেবিলের জন্য সমস্ত কনফিগারেশন ফেচ করার ফাংশন
const getAllFeeConfigs = async (req, res) => {
    try {
        const query = `SELECT * FROM dynamic_fees_config ORDER BY country ASC, platform ASC`;
        const result = await pool.query(query);
        return res.status(200).json({ success: true, data: result.rows });
    } catch (error) {
        console.error('Error in getAllFeeConfigs:', error);
        return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
};

// নির্দিষ্ট কনফিগারেশন ডিলিট করার ফাংশন
const deleteFeeConfig = async (req, res) => {
    try {
        const { country, platform } = req.params;
        const query = `DELETE FROM dynamic_fees_config WHERE LOWER(country) = LOWER($1) AND LOWER(platform) = LOWER($2) RETURNING *`;
        const result = await pool.query(query, [country.trim(), platform.trim()]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Configuration not found.' });
        }
        
        return res.status(200).json({ success: true, message: 'Fee configuration deleted successfully.' });
    } catch (error) {
        console.error('Error in deleteFeeConfig:', error);
        return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
};

module.exports = { upsertFeeConfig, getFeeConfig, getAllFeeConfigs, deleteFeeConfig, getLiveExchangeRate };
