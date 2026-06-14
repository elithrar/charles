export type AppError = {
  _tag: 'InvalidInput' | 'Unauthorized' | 'ExternalService' | 'Configuration';
  message: string;
};

export function invalidInput(message: string): AppError {
  return { _tag: 'InvalidInput', message };
}

export function unauthorized(message = 'Unauthorized'): AppError {
  return { _tag: 'Unauthorized', message };
}

export function externalService(message: string): AppError {
  return { _tag: 'ExternalService', message };
}

export function configuration(message: string): AppError {
  return { _tag: 'Configuration', message };
}
