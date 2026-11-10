import { ValidationError } from '../utils/errors.js';

export function validateRequest(schema) {
  return (req, res, next) => {
    try {
      const shape = schema.shape;
      const isContainer = shape && (shape.body || shape.query || shape.params);

      const dataToValidate = isContainer
        ? {
            ...(shape.body ? { body: req.body } : {}),
            ...(shape.query ? { query: req.query } : {}),
            ...(shape.params ? { params: req.params } : {}),
          }
        : req.body;

      const result = schema.safeParse ? schema.safeParse(dataToValidate) : null;
      if (result && !result.success) {
        throw new ValidationError('Validation failed on request parameters', result.error.errors);
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
