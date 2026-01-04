/**
 * 자연어 쿼리 파서
 * 사용자 질문을 KOSIS API 파라미터로 변환
 */

// 키워드 → 통계 분류 매핑
export const TOPIC_MAPPINGS: Record<string, {
  category: string;
  keywords: string[];
  viewCode?: string;
}> = {
  // 인구 관련
  '인구': { category: 'population', keywords: ['총인구', '인구수', '인구통계'] },
  '출생': { category: 'population', keywords: ['출생아수', '출생률', '합계출산율'] },
  '사망': { category: 'population', keywords: ['사망자수', '사망률', '기대수명'] },
  '고령화': { category: 'population', keywords: ['고령인구', '노인인구', '고령화율'] },
  '혼인': { category: 'population', keywords: ['혼인건수', '혼인율', '결혼'] },
  '이혼': { category: 'population', keywords: ['이혼건수', '이혼율'] },
  '출산': { category: 'population', keywords: ['출산율', '합계출산율', '저출산'] },
  '세대': { category: 'population', keywords: ['가구수', '세대수', '1인가구'] },

  // 경제 관련
  'GDP': { category: 'economy', keywords: ['국내총생산', 'GDP', '경제규모'] },
  '물가': { category: 'economy', keywords: ['소비자물가', '물가지수', 'CPI'] },
  '경제성장': { category: 'economy', keywords: ['경제성장률', 'GDP성장률'] },
  '수출': { category: 'economy', keywords: ['수출액', '수출입', '무역'] },
  '수입': { category: 'economy', keywords: ['수입액', '무역수지'] },
  '소비': { category: 'economy', keywords: ['소비자물가', '소비지출', '가계지출'] },
  '금리': { category: 'economy', keywords: ['금리', '이자율', '기준금리'] },
  '환율': { category: 'economy', keywords: ['환율', '원달러', '원화'] },
  '주가': { category: 'economy', keywords: ['주가', '코스피', 'KOSPI'] },

  // 고용 관련
  '실업': { category: 'employment', keywords: ['실업률', '실업자', '실업자수'] },
  '취업': { category: 'employment', keywords: ['취업자', '고용률', '취업자수'] },
  '임금': { category: 'employment', keywords: ['평균임금', '급여', '월급'] },
  '고용': { category: 'employment', keywords: ['고용률', '경제활동인구'] },
  '근로': { category: 'employment', keywords: ['근로시간', '노동시간', '근무시간'] },
  '청년': { category: 'employment', keywords: ['청년실업', '청년고용', '청년취업'] },

  // 주거/부동산 관련
  '주택': { category: 'housing', keywords: ['주택수', '주택가격', '주택매매'] },
  '부동산': { category: 'housing', keywords: ['부동산', '토지', '지가'] },
  '아파트': { category: 'housing', keywords: ['아파트가격', '아파트시세', '아파트매매'] },
  '전세': { category: 'housing', keywords: ['전세가격', '전세지수', '전세시세'] },
  '매매': { category: 'housing', keywords: ['매매가격', '매매지수', '주택매매'] },
  '월세': { category: 'housing', keywords: ['월세가격', '임대료', '월세시세'] },
  '집값': { category: 'housing', keywords: ['집값', '주택가격', '아파트가격'] },
  '부동산가격': { category: 'housing', keywords: ['부동산가격', '토지가격', '지가'] },

  // 교육 관련
  '교육': { category: 'education', keywords: ['학생수', '학교', '교육'] },
  '학교': { category: 'education', keywords: ['학교수', '학급수'] },
  '대학': { category: 'education', keywords: ['대학교', '진학률', '대학생'] },
  '학생': { category: 'education', keywords: ['학생수', '재학생', '입학'] },

  // 보건 관련
  '건강': { category: 'health', keywords: ['건강', '의료', '병원'] },
  '병원': { category: 'health', keywords: ['병원수', '의료기관'] },
  '의료': { category: 'health', keywords: ['의료비', '건강보험'] },
  '코로나': { category: 'health', keywords: ['코로나19', '확진자', '감염병'] },
  '자살': { category: 'health', keywords: ['자살률', '자살사망', '자살자수'] },

  // 환경 관련
  '환경': { category: 'environment', keywords: ['환경', '대기질', '수질'] },
  '미세먼지': { category: 'environment', keywords: ['미세먼지', 'PM2.5', 'PM10'] },
  '탄소': { category: 'environment', keywords: ['탄소배출', '온실가스'] },
  '기후': { category: 'environment', keywords: ['기후', '기온', '강수량'] },
  '폐기물': { category: 'environment', keywords: ['폐기물', '쓰레기', '재활용'] },

  // 교통 관련
  '교통': { category: 'transport', keywords: ['교통', '자동차', '대중교통'] },
  '자동차': { category: 'transport', keywords: ['자동차등록', '차량', '승용차'] },
  '교통사고': { category: 'transport', keywords: ['교통사고', '사고건수', '교통사망'] },

  // 사회/복지 관련
  '범죄': { category: 'social', keywords: ['범죄율', '범죄건수', '범죄발생'] },
  '복지': { category: 'social', keywords: ['복지', '사회보장', '연금'] },
  '빈곤': { category: 'social', keywords: ['빈곤율', '저소득', '기초생활'] },
  '다문화': { category: 'social', keywords: ['다문화가구', '외국인', '이민자'] },
};

/**
 * 지역명 → 지역코드 매핑 (표준 행정구역 코드)
 *
 * ⚠️ 주의: KOSIS 통계표마다 다른 지역 코드 체계를 사용할 수 있습니다!
 * - 아래 코드는 표준 행정구역 코드입니다
 * - 일부 통계표는 단순화된 코드를 사용합니다 (예: 일부 표에서 부산=21)
 * - 정확한 코드는 get_table_info를 호출하여 확인하세요
 *
 * 표준 행정구역 코드 참조:
 * 00=전국, 11=서울, 26=부산, 27=대구, 28=인천, 29=광주, 30=대전, 31=울산
 * 36=세종, 41=경기, 42=강원, 43=충북, 44=충남, 45=전북, 46=전남, 47=경북, 48=경남, 50=제주
 */
export const REGION_CODES: Record<string, string> = {
  '전국': '00',
  '서울': '11',
  '서울특별시': '11',
  '부산': '26',
  '부산광역시': '26',
  '대구': '27',
  '대구광역시': '27',
  '인천': '28',
  '인천광역시': '28',
  '광주': '29',
  '광주광역시': '29',
  '대전': '30',
  '대전광역시': '30',
  '울산': '31',
  '울산광역시': '31',
  '세종': '36',
  '세종특별자치시': '36',
  '경기': '41',
  '경기도': '41',
  '강원': '42',
  '강원도': '42',
  '강원특별자치도': '42',
  '충북': '43',
  '충청북도': '43',
  '충남': '44',
  '충청남도': '44',
  '전북': '45',
  '전라북도': '45',
  '전북특별자치도': '45',
  '전남': '46',
  '전라남도': '46',
  '경북': '47',
  '경상북도': '47',
  '경남': '48',
  '경상남도': '48',
  '제주': '50',
  '제주도': '50',
  '제주특별자치도': '50',
};

// 시간 표현 패턴
const TIME_PATTERNS = [
  { pattern: /최근\s*(\d+)\s*년/, type: 'recent_years' },
  { pattern: /(\d{4})년/, type: 'specific_year' },
  { pattern: /올해|금년/, type: 'this_year' },
  { pattern: /작년|전년|지난해/, type: 'last_year' },
  { pattern: /(\d{4})\s*~\s*(\d{4})/, type: 'year_range' },
];

export interface ParsedQuery {
  topics: string[];
  regions: string[];
  timeRange?: {
    type: 'recent' | 'specific' | 'range';
    value?: number;
    start?: string;
    end?: string;
  };
  keywords: string[];
  intent: 'search' | 'compare' | 'trend' | 'explain';
}

/**
 * 자연어 쿼리 파싱
 */
export function parseQuery(query: string): ParsedQuery {
  const result: ParsedQuery = {
    topics: [],
    regions: [],
    keywords: [],
    intent: 'search',
  };

  const lowerQuery = query.toLowerCase();

  // 1. 주제 분석
  for (const [keyword, mapping] of Object.entries(TOPIC_MAPPINGS)) {
    if (query.includes(keyword)) {
      result.topics.push(mapping.category);
      result.keywords.push(...mapping.keywords);
    }
  }

  // 2. 지역 분석
  for (const [regionName, code] of Object.entries(REGION_CODES)) {
    if (query.includes(regionName)) {
      result.regions.push(code);
    }
  }

  // 3. 시간 표현 분석
  for (const { pattern, type } of TIME_PATTERNS) {
    const match = query.match(pattern);
    if (match) {
      switch (type) {
        case 'recent_years':
          result.timeRange = {
            type: 'recent',
            value: parseInt(match[1], 10),
          };
          break;
        case 'specific_year':
          result.timeRange = {
            type: 'specific',
            start: match[1],
            end: match[1],
          };
          break;
        case 'this_year':
          const thisYear = new Date().getFullYear().toString();
          result.timeRange = {
            type: 'specific',
            start: thisYear,
            end: thisYear,
          };
          break;
        case 'last_year':
          const lastYear = (new Date().getFullYear() - 1).toString();
          result.timeRange = {
            type: 'specific',
            start: lastYear,
            end: lastYear,
          };
          break;
        case 'year_range':
          result.timeRange = {
            type: 'range',
            start: match[1],
            end: match[2],
          };
          break;
      }
      break; // 첫 번째 매칭만 사용
    }
  }

  // 4. 의도 분석
  if (lowerQuery.includes('비교') || lowerQuery.includes('차이') || lowerQuery.includes('vs')) {
    result.intent = 'compare';
  } else if (lowerQuery.includes('추세') || lowerQuery.includes('변화') || lowerQuery.includes('추이')) {
    result.intent = 'trend';
  } else if (lowerQuery.includes('뭐') || lowerQuery.includes('무엇') || lowerQuery.includes('설명')) {
    result.intent = 'explain';
  }

  // 5. 키워드가 없으면 원본 쿼리 사용
  if (result.keywords.length === 0) {
    result.keywords = query
      .split(/\s+/)
      .filter((word) => word.length > 1);
  }

  // 중복 제거
  result.topics = [...new Set(result.topics)];
  result.keywords = [...new Set(result.keywords)];

  return result;
}

// 지역코드 → 지역명 역매핑
export const REGION_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(REGION_CODES).map(([name, code]) => [code, name])
);

/**
 * 검색어 생성
 * 지역명이 있는 경우 지역명을 검색어에 포함
 */
export function generateSearchTerms(parsed: ParsedQuery, originalQuery?: string): string[] {
  const terms: string[] = [];

  // 지역명이 있으면 "지역명 + 주제" 조합 검색어 생성
  if (parsed.regions.length > 0) {
    const regionNames = parsed.regions.map(code => REGION_NAMES[code]).filter(Boolean);
    const topicKeywords = parsed.keywords.slice(0, 2);

    // 지역명 + 키워드 조합
    for (const region of regionNames) {
      for (const keyword of topicKeywords) {
        terms.push(`${region} ${keyword}`);
      }
    }

    // 지역명만으로도 검색
    terms.push(...regionNames);
  }

  // 키워드 조합 (지역 없이)
  terms.push(...parsed.keywords.slice(0, 3));

  return [...new Set(terms)];
}
