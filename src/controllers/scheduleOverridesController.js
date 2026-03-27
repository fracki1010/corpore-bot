const {
  listExceptions,
  upsertException,
  deleteException,
} = require("../services/openingExceptionsService");

function isValidationError(error) {
  return typeof error?.message === "string" && error.message.startsWith("VALIDATION:");
}

const getScheduleOverrides = (_req, res) => {
  try {
    const data = listExceptions();
    return res.status(200).json({ success: true, data });
  } catch (_error) {
    return res.status(500).json({
      success: false,
      error: "No se pudieron obtener las excepciones.",
    });
  }
};

const upsertScheduleOverride = (req, res) => {
  try {
    const { date, isOpen, reason } = req.body;
    const result = upsertException({ date, isOpen, reason });

    return res.status(result.created ? 201 : 200).json({
      success: true,
      message: result.created ? "Excepción creada." : "Excepción actualizada.",
      data: result.item,
    });
  } catch (error) {
    if (isValidationError(error)) {
      return res.status(400).json({
        success: false,
        error: error.message.replace("VALIDATION:", "").trim(),
      });
    }

    return res.status(500).json({
      success: false,
      error: "No se pudo guardar la excepción.",
    });
  }
};

const deleteScheduleOverride = (req, res) => {
  try {
    const { date } = req.params;
    const removed = deleteException(date);

    if (!removed) {
      return res.status(404).json({
        success: false,
        error: "No existe una excepción para esa fecha.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Excepción eliminada.",
    });
  } catch (error) {
    if (isValidationError(error)) {
      return res.status(400).json({
        success: false,
        error: error.message.replace("VALIDATION:", "").trim(),
      });
    }

    return res.status(500).json({
      success: false,
      error: "No se pudo eliminar la excepción.",
    });
  }
};

module.exports = {
  getScheduleOverrides,
  upsertScheduleOverride,
  deleteScheduleOverride,
};
