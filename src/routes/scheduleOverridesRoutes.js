const express = require("express");
const {
  getScheduleOverrides,
  upsertScheduleOverride,
  deleteScheduleOverride,
} = require("../controllers/scheduleOverridesController");
const { requireAdminApiKey } = require("../middlewares/adminApiKeyMiddleware");

const router = express.Router();

router.use(requireAdminApiKey);
router.get("/", getScheduleOverrides);
router.post("/", upsertScheduleOverride);
router.delete("/:date", deleteScheduleOverride);

module.exports = router;
