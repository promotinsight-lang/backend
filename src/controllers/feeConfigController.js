const pool = require('../config/db');

// অ্যাডমিন প্যানেল থেকে ডায়নামিক ফি কনফিগারেশন সেভ বা আপডেট (UPSERT) করার ফাংশন
const upsertFeeConfig = async (req, res) => {
    try {
        const { country, platform, platform_charge = 0, buyer_reward = 0, buyer_refund_fee = 0, seller_deposit_fee = 0, seller_withdrawal_fee = 0 } = req.body;

        if (!country || !platform) {
            return res.status(400).json({ success: false, message: 'Country and Platform are required fields.' });
        }

        const query = `
            INSERT INTO dynamic_fees_config (
                country, platform, platform_charge, buyer_reward, 
                buyer_refund_fee, seller_deposit_fee, seller_withdrawal_fee
            ) 
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (country, platform) 
            DO UPDATE SET 
                platform_charge = EXCLUDED.platform_charge,
                buyer_reward = EXCLUDED.buyer_reward,
                buyer_refund_fee = EXCLUDED.buyer_refund_fee,
                seller_deposit_fee = EXCLUDED.seller_deposit_fee,
                seller_withdrawal_fee = EXCLUDED.seller_withdrawal_fee,
                updated_at = CURRENT_TIMESTAMP
            RETURNING *;
        `;

        const values = [
            country.trim(), platform.trim(), platform_charge, buyer_reward,
            buyer_refund_fee, seller_deposit_fee, seller_withdrawal_fee
        ];

        const result = await pool.query(query, values);

        return res.status(200).json({ success: true, message: 'Fee configuration saved/updated successfully.', data: result.rows[0] });

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

        // 🔥 FIXED: 404 এর বদলে 200 রিটার্ন করা হলো null ডেটা সহ। এর ফলে ব্রাউজার কনসোলে আর লাল এরর আসবে না।
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

module.exports = { upsertFeeConfig, getFeeConfig, getAllFeeConfigs, deleteFeeConfig };