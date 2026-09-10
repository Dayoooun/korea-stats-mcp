/**
 * 에러 처리 유틸리티
 */

export enum ErrorCode {
  INVALID_API_KEY = "INVALID_API_KEY",
  RATE_LIMIT_EXCEEDED = "RATE_LIMIT_EXCEEDED",
  INVALID_PARAMETER = "INVALID_PARAMETER",
  NO_DATA_FOUND = "NO_DATA_FOUND",
  API_UNAVAILABLE = "API_UNAVAILABLE",
  NETWORK_ERROR = "NETWORK_ERROR",
  TIMEOUT = "TIMEOUT",
  HTTP_ERROR = "HTTP_ERROR",
  RESPONSE_TOO_LARGE = "RESPONSE_TOO_LARGE",
  METADATA_TOO_LARGE = "METADATA_TOO_LARGE",
  INVALID_RESPONSE = "INVALID_RESPONSE",
  INVALID_INPUT = "INVALID_INPUT",
  API_ERROR = "API_ERROR",
  UNKNOWN_ERROR = "UNKNOWN_ERROR",
}

const ERROR_MESSAGES: Record<ErrorCode, string> = {
  [ErrorCode.INVALID_API_KEY]:
    "서버 운영자에게 KOSIS_API_KEY 설정을 확인해 주세요.",
  [ErrorCode.RATE_LIMIT_EXCEEDED]:
    "요청 한도를 초과했습니다. 잠시 후 다시 시도해주세요.",
  [ErrorCode.INVALID_PARAMETER]:
    "검색 조건이 올바르지 않습니다. 다른 조건으로 시도해주세요.",
  [ErrorCode.NO_DATA_FOUND]: "해당 조건에 맞는 데이터가 없습니다.",
  [ErrorCode.API_UNAVAILABLE]:
    "KOSIS 서비스가 일시적으로 응답하지 않습니다. 잠시 후 다시 시도해주세요.",
  [ErrorCode.NETWORK_ERROR]: "네트워크 연결을 확인해주세요.",
  [ErrorCode.TIMEOUT]: "KOSIS API 응답 시간이 초과되었습니다.",
  [ErrorCode.HTTP_ERROR]: "KOSIS 서비스가 HTTP 오류를 반환했습니다.",
  [ErrorCode.RESPONSE_TOO_LARGE]: "KOSIS 응답이 허용된 크기를 초과했습니다.",
  [ErrorCode.METADATA_TOO_LARGE]:
    "KOSIS 메타데이터 응답이 허용된 크기를 초과했습니다.",
  [ErrorCode.INVALID_RESPONSE]: "KOSIS 응답 형식이 올바르지 않습니다.",
  [ErrorCode.INVALID_INPUT]: "입력 조건이 올바르지 않습니다.",
  [ErrorCode.API_ERROR]: "KOSIS 서비스가 오류 응답을 반환했습니다.",
  [ErrorCode.UNKNOWN_ERROR]: "알 수 없는 오류가 발생했습니다.",
};

const KNOWN_ERROR_CODES = new Set<string>(Object.values(ErrorCode));
const NUMERIC_ERROR_CODE = /^\d{1,4}$/;

function hasOwn(value: object, key: string): boolean {
  try {
    return Object.prototype.hasOwnProperty.call(value, key);
  } catch {
    return false;
  }
}

function normalizeErrorCode(value: unknown): string {
  if (typeof value === "string") {
    if (KNOWN_ERROR_CODES.has(value) || NUMERIC_ERROR_CODE.test(value)) {
      return value;
    }
    return ErrorCode.UNKNOWN_ERROR;
  }
  if (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 9999
  ) {
    return String(value);
  }
  return ErrorCode.UNKNOWN_ERROR;
}

function readCode(error: unknown): unknown {
  if (
    (typeof error !== "object" && typeof error !== "function") ||
    error === null
  ) {
    return undefined;
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, "code");
    return descriptor === undefined ? undefined : descriptor.value;
  } catch {
    return undefined;
  }
}

/**
 * 사용자 친화적 에러 메시지 반환
 */
export function getErrorMessage(code: ErrorCode | string): string {
  if (typeof code !== "string" || !hasOwn(ERROR_MESSAGES, code)) {
    return ERROR_MESSAGES[ErrorCode.UNKNOWN_ERROR];
  }
  return ERROR_MESSAGES[code as ErrorCode];
}

/**
 * 에러를 안전하게 처리하고 결과 반환
 */
export function handleToolError(error: unknown): {
  success: false;
  error: string;
  code: string;
} {
  const code = normalizeErrorCode(readCode(error));
  return {
    success: false,
    error: getErrorMessage(code),
    code,
  };
}
