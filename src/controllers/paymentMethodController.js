const pool = require("../config/db");

// =============================================
// 👑 GET ALL PAYMENT METHODS (Public/Admin)
// =============================================
const getAllPaymentMethods = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        pm.*, 
        COALESCE(
          json_agg(
            DISTINCT jsonb_build_object('id', pmn.id, 'name', pmn.network_name, 'code', pmn.network_code)
          ) FILTER (WHERE pmn.id IS NOT NULL), '[]'::json
        ) as networks,
        COALESCE(
          json_agg(
            DISTINCT jsonb_build_object('type', pmf.fee_type, 'amount', pmf.fee_amount, 'percentage', pmf.fee_percentage)
          ) FILTER (WHERE pmf.id IS NOT NULL), '[]'::json
        ) as fees
      FROM payment_methods pm
      LEFT JOIN payment_method_networks pmn ON pm.id = pmn.payment_method_id
      LEFT JOIN payment_fee_config pmf ON pm.id = pmf.payment_method_id
      WHERE pm.active = TRUE
      GROUP BY pm.id
      ORDER BY pm.created_at ASC
    `);
    
    res.status(200).json({ success: true, data: result.rows });
  } catch (error) {
    console.error("GET PAYMENT METHODS ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// =============================================
// ✏️ UPDATE PAYMENT METHOD (Admin)
// =============================================
const updatePaymentMethod = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, active, qr_code_url } = req.body;

    const updateResult = await pool.query(
      `UPDATE payment_methods 
       SET name = COALESCE($1, name), 
           description = COALESCE($2, description),
           active = COALESCE($3, active),
           qr_code_url = COALESCE($4, qr_code_url)
       WHERE id = $5 RETURNING *`,
      [name, description, active, qr_code_url, id]
    );

    if (updateResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Payment method not found" });
    }

    res.status(200).json({ success: true, message: "Updated successfully", data: updateResult.rows[0] });
  } catch (error) {
    console.error("UPDATE PAYMENT METHOD ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// =============================================
// 🔗 ADD NETWORK (Admin)
// =============================================
const addNetwork = async (req, res) => {
  try {
    const { payment_method_id, network_name, network_code } = req.body;

    if (!payment_method_id || !network_name) {
      return res.status(400).json({ success: false, message: "Missing required fields" });
    }

    const result = await pool.query(
      `INSERT INTO payment_method_networks (payment_method_id, network_name, network_code)
       VALUES ($1, $2, $3) RETURNING *`,
      [payment_method_id, network_name, network_code]
    );

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error("ADD NETWORK ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// =============================================
// 🗑️ DELETE NETWORK (Admin)
// =============================================
const deleteNetwork = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`DELETE FROM payment_method_networks WHERE id = $1 RETURNING *`, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Network not found" });
    }

    res.status(200).json({ success: true, message: "Network deleted" });
  } catch (error) {
    console.error("DELETE NETWORK ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = { getAllPaymentMethods, updatePaymentMethod, addNetwork, deleteNetwork };