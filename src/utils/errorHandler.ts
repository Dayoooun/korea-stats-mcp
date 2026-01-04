/**
 * 에러 처리 유틸리티
 */

export enum ErrorCode {
  INVALID_API_KEY = 'INVALID_API_KEY',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  INVALID_PARAMETER = 'INVALID_PARAMETER',
  NO_DATA_FOUND = 'NO_DATA_FOUND',
  API_UNAVAILABLE = 'API_UNAVAILABLE',
  NETWORK_ERROR = 'NETWORK_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

const ERROR_MESSAGES: Record<ErrorCode, string> = {
  [ErrorCode.INVALID_API_KEY]:
    'API 키가 유효하지 않습니다. 환경 설정을 확인해주세요.',
  [ErrorCode.RATE_LIMIT_EXCEEDED]:
    '요청 한도를 초과했습니다. 잠시 후 다시 시도해주세요.',
  [ErrorCode.INVALID_PARAMETER]:
    '검색 조건이 올바르지 않습니다. 다른 조건으로 시도해주세요.',
  [ErrorCode.NO_DATA_FOUND]:
    '해당 조건에 맞는 데이터가 없습니다.',
  [ErrorCode.API_UNAVAILABLE]:
    'KOSIS 서비스가 일시적으로 응답하지 않습니다. 잠시 후 다시 시도해주세요.',
  [ErrorCode.NETWORK_ERROR]:
    '네트워크 연결을 확인해주세요.',
  [ErrorCode.UNKNOWN_ERROR]:
    '알 수 없는 오류가 발생했습니다.',
};

/**
 * 사용자 친화적 에러 메시지 반환
 */
export function getErrorMessage(code: ErrorCode | string): string {
  return ERROR_MESSAGES[code as ErrorCode] || ERROR_MESSAGES[ErrorCode.UNKNOWN_ERROR];
}

/**
 * 에러를 안전하게 처리하고 결과 반환
 */
export function handleToolError(error: unknown): {
  success: false;
  error: string;
  code: string;
} {
  console.error('Tool error:', error);

  if (error instanceof Error) {
    // KOSIS API 에러
    if ('code' in error) {
      const code = (error as { code: string }).code;
      return {
        success: false,
        error: getErrorMessage(code),
        code,
      };
    }

    return {
      success: false,
      error: error.message,
      code: ErrorCode.UNKNOWN_ERROR,
    };
  }

  return {
    success: false,
    error: getErrorMessage(ErrorCode.UNKNOWN_ERROR),
    code: ErrorCode.UNKNOWN_ERROR,
  };
}

/**
 * 재시도 래퍼 함수
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    baseDelay?: number;
    maxDelay?: number;
  } = {}
): Promise<T> {
  const { maxRetries = 3, baseDelay = 1000, maxDelay = 10000 } = options;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      // 재시도 불가능한 에러인 경우 즉시 throw
      if (isNonRetryableError(error)) {
        throw error;
      }

      // 마지막 시도가 아니면 대기
      if (attempt < maxRetries - 1) {
        const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
        await sleep(delay);
      }
    }
  }

  throw lastError;
}

function isNonRetryableError(error: unknown): boolean {
  if (error instanceof Error && 'code' in error) {
    const code = (error as { code: string }).code;
    return [
      ErrorCode.INVALID_API_KEY,
      ErrorCode.INVALID_PARAMETER,
    ].includes(code as ErrorCode);
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
