// Единая фабрика ошибок API: статус, машинный код (для i18n на фронте) и английский текст.
export function httpError(status, code, message) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

// Оборачивает async-роут, чтобы отклонённый промис попал в обработчик ошибок Express.
export const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
