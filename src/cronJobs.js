const cron = require('node-cron');
const pool = require('./config/db');

const startCronJobs = () => {
    // Proti ghontay ekbar run hobe ('0 * * * *')
    cron.schedule('0 * * * *', async () => {
        console.log("🕒 Running Auto-Approve Cron Job...");
        
        const client = await pool.connect(); // 🛡️ Dedicated client for stable transactions
        try {
            await client.query("BEGIN");

            // 🛡️ SECURE: FOR UPDATE SKIP LOCKED prevents database deadlocks 
            // if other transactions are trying to modify these rows simultaneously.
            const findQuery = `
                SELECT a.id, a.user_id, p.price, p.reward 
                FROM applications a
                JOIN products p ON a.product_id = p.id
                WHERE a.status = 'review_submitted' 
                AND a.updated_at <= NOW() - INTERVAL '24 hours'
                FOR UPDATE SKIP LOCKED
            `;
            const result = await client.query(findQuery);

            if (result.rows.length === 0) {
                await client.query("COMMIT");
                console.log("✅ No pending reviews older than 24 hours found.");
                return;
            }

            for (let app of result.rows) {
                const totalCashback = parseFloat(app.price) + parseFloat(app.reward);

                // 1. Status 'completed' kora
                await client.query(
                    `UPDATE applications SET status = 'completed', updated_at = NOW() WHERE id = $1`, 
                    [app.id]
                );

                // 2. Buyer-er wallet-e balance add kora securely
                await client.query(
                    `UPDATE users SET wallet_balance = wallet_balance + $1 WHERE id = $2`, 
                    [totalCashback, app.user_id]
                );
                
                console.log(`✅ Auto-approved application ID: ${app.id} for User ID: ${app.user_id}`);
            }

            await client.query("COMMIT");
            console.log(`🎉 Auto-Approve Cron Job completed. Processed ${result.rows.length} records.`);
        } catch (error) {
            await client.query("ROLLBACK");
            console.error("❌ Cron Job Error:", error);
        } finally {
            client.release();
        }
    });
};

module.exports = startCronJobs;