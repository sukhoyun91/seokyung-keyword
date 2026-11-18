/**
 * 전국 시·도 / 시·군·구 목록 (2026년 기준)
 * - ldong: 법정동 시도코드 (TourAPI KorService2 lDongRegnCd). 강원·전북은 특별자치도 전환 후 새 코드와 옛 코드 모두
 * - area: TourAPI 옛 지역코드 (areaCode)
 * - alias: 주소에 쓰이는 시·도 표기
 * 인천은 2026.7.1 행정체제 개편(제물포구·영종구·검단구) 반영. 옛 주소 표기는 legacy 로 함께 인식
 */
export interface Sido {
  name: string;
  short: string;
  ldong: string[];
  area: string;
  alias: string[];
  regions: string[];
}

export const SIDO: Sido[] = [
  { name: '서울특별시', short: '서울', ldong: ['11'], area: '1', alias: ['서울특별시', '서울시', '서울'], regions: ['종로구', '중구', '용산구', '성동구', '광진구', '동대문구', '중랑구', '성북구', '강북구', '도봉구', '노원구', '은평구', '서대문구', '마포구', '양천구', '강서구', '구로구', '금천구', '영등포구', '동작구', '관악구', '서초구', '강남구', '송파구', '강동구'] },
  { name: '부산광역시', short: '부산', ldong: ['26'], area: '6', alias: ['부산광역시', '부산시', '부산'], regions: ['중구', '서구', '동구', '영도구', '부산진구', '동래구', '남구', '북구', '해운대구', '사하구', '금정구', '강서구', '연제구', '수영구', '사상구', '기장군'] },
  { name: '대구광역시', short: '대구', ldong: ['27'], area: '4', alias: ['대구광역시', '대구시', '대구'], regions: ['중구', '동구', '서구', '남구', '북구', '수성구', '달서구', '달성군', '군위군'] },
  { name: '인천광역시', short: '인천', ldong: ['28'], area: '2', alias: ['인천광역시', '인천시', '인천'], regions: ['제물포구', '영종구', '미추홀구', '연수구', '남동구', '부평구', '계양구', '서구', '검단구', '강화군', '옹진군'] },
  { name: '광주광역시', short: '광주', ldong: ['29'], area: '5', alias: ['광주광역시', '광주시', '광주'], regions: ['동구', '서구', '남구', '북구', '광산구'] },
  { name: '대전광역시', short: '대전', ldong: ['30'], area: '3', alias: ['대전광역시', '대전시', '대전'], regions: ['동구', '중구', '서구', '유성구', '대덕구'] },
  { name: '울산광역시', short: '울산', ldong: ['31'], area: '7', alias: ['울산광역시', '울산시', '울산'], regions: ['중구', '남구', '동구', '북구', '울주군'] },
  { name: '세종특별자치시', short: '세종', ldong: ['36'], area: '8', alias: ['세종특별자치시', '세종시', '세종'], regions: ['세종시'] },
  { name: '경기도', short: '경기', ldong: ['41'], area: '31', alias: ['경기도', '경기'], regions: ['수원시', '성남시', '의정부시', '안양시', '부천시', '광명시', '평택시', '동두천시', '안산시', '고양시', '과천시', '구리시', '남양주시', '오산시', '시흥시', '군포시', '의왕시', '하남시', '용인시', '파주시', '이천시', '안성시', '김포시', '화성시', '광주시', '양주시', '포천시', '여주시', '연천군', '가평군', '양평군'] },
  { name: '강원특별자치도', short: '강원', ldong: ['51', '42'], area: '32', alias: ['강원특별자치도', '강원도', '강원'], regions: ['춘천시', '원주시', '강릉시', '동해시', '태백시', '속초시', '삼척시', '홍천군', '횡성군', '영월군', '평창군', '정선군', '철원군', '화천군', '양구군', '인제군', '고성군', '양양군'] },
  { name: '충청북도', short: '충북', ldong: ['43'], area: '33', alias: ['충청북도', '충북'], regions: ['청주시', '충주시', '제천시', '보은군', '옥천군', '영동군', '증평군', '진천군', '괴산군', '음성군', '단양군'] },
  { name: '충청남도', short: '충남', ldong: ['44'], area: '34', alias: ['충청남도', '충남'], regions: ['천안시', '공주시', '보령시', '아산시', '서산시', '논산시', '계룡시', '당진시', '금산군', '부여군', '서천군', '청양군', '홍성군', '예산군', '태안군'] },
  { name: '전북특별자치도', short: '전북', ldong: ['52', '45'], area: '37', alias: ['전북특별자치도', '전라북도', '전북'], regions: ['전주시', '군산시', '익산시', '정읍시', '남원시', '김제시', '완주군', '진안군', '무주군', '장수군', '임실군', '순창군', '고창군', '부안군'] },
  { name: '전라남도', short: '전남', ldong: ['46'], area: '38', alias: ['전라남도', '전남'], regions: ['목포시', '여수시', '순천시', '나주시', '광양시', '담양군', '곡성군', '구례군', '고흥군', '보성군', '화순군', '장흥군', '강진군', '해남군', '영암군', '무안군', '함평군', '영광군', '장성군', '완도군', '진도군', '신안군'] },
  { name: '경상북도', short: '경북', ldong: ['47'], area: '35', alias: ['경상북도', '경북'], regions: ['포항시', '경주시', '김천시', '안동시', '구미시', '영주시', '영천시', '상주시', '문경시', '경산시', '의성군', '청송군', '영양군', '영덕군', '청도군', '고령군', '성주군', '칠곡군', '예천군', '봉화군', '울진군', '울릉군'] },
  { name: '경상남도', short: '경남', ldong: ['48'], area: '36', alias: ['경상남도', '경남'], regions: ['창원시', '진주시', '통영시', '사천시', '김해시', '밀양시', '거제시', '양산시', '의령군', '함안군', '창녕군', '고성군', '남해군', '하동군', '산청군', '함양군', '거창군', '합천군'] },
  { name: '제주특별자치도', short: '제주', ldong: ['50'], area: '39', alias: ['제주특별자치도', '제주도', '제주'], regions: ['제주시', '서귀포시'] },
];

/** 옛 행정구역 표기 (주소에 남아 있는 경우) */
const LEGACY: Record<string, Record<string, string[]>> = {
  인천광역시: { 제물포구: ['중구', '동구'], 영종구: ['영종', '용유'], 검단구: ['검단'] },
};

export function findSido(name: string): Sido | undefined {
  const n = String(name ?? '').trim();
  return SIDO.find((s) => s.name === n || s.short === n || s.alias.includes(n));
}

/** "진주시" → "진주", "중구" → "중구" (구는 줄이면 뜻이 없어 그대로) */
export function shortRegion(r: string) {
  return /[시군]$/.test(r) && r.length > 2 ? r.slice(0, -1) : r;
}

/** 자치구(구)는 이름이 여러 시·도에 겹쳐 검색어·판별에 시·도 이름이 필요 */
export const isGu = (r: string) => /구$/.test(r);

/** 주소가 이 시·도 것인지 (주소 표기 + 법정동 코드 + 옛 지역코드) */
export function inSido(sido: Sido, addr: string, it?: Record<string, any>) {
  const ld = String(it?.ldongregncd ?? '');
  if (ld && sido.ldong.some((c) => ld.startsWith(c))) return true;
  if (it?.areacode != null && String(it.areacode) === sido.area) return true;
  const head = addr.trim().split(/\s+/)[0] ?? '';
  if (sido.alias.some((a) => head === a)) return true;
  // 본문 중간 표기는 정식 이름만 인정 ("경기도 광주시"가 광주광역시로 잡히지 않게 "광주시" 같은 줄임은 제외)
  return sido.alias.filter((a) => a.length >= 3 && !a.endsWith('시') || a === sido.name).some((a) => addr.includes(a));
}

/**
 * 주소(와 제목)에서 선택 지역 찾기
 * - 주소는 띄어쓰기 단위로 정확히 비교 ("달서구"가 "서구"로 잘못 잡히지 않게)
 * - 시·군은 제목에 짧은 이름이 있어도 인정 ("진주남강유등축제" → 진주시)
 */
export function matchRegion(sido: Sido, regions: string[], addr: string, title = ''): string | undefined {
  const tokens = addr.replace(/[(),]/g, ' ').split(/\s+/).filter(Boolean);
  if (sido.regions.length === 1 && regions.length) return regions[0]; // 세종
  for (const r of regions) {
    if (tokens.includes(r)) return r;
    const legacy = LEGACY[sido.name]?.[r];
    if (legacy && tokens.some((t) => legacy.some((l) => t === l || t.startsWith(l)))) return r;
  }
  for (const r of regions) {
    if (isGu(r)) continue;
    const s = shortRegion(r);
    if (s.length >= 2 && (tokens.some((t) => t === s || t.startsWith(r)) || title.includes(s))) return r;
  }
  return undefined;
}

/** 뉴스 검색어용 지역 표기: 시·군은 "진주", 구는 "부산 중구" */
export function regionQuery(sido: Sido, r: string) {
  if (sido.regions.length === 1) return sido.short;
  return isGu(r) ? `${sido.short} ${r}` : shortRegion(r);
}

/** 기사 본문에 그 지역이 언급됐는지 */
export function textMentions(sido: Sido, r: string, text: string) {
  if (sido.regions.length === 1) return text.includes(sido.short);
  if (isGu(r)) return text.includes(r) && sido.alias.some((a) => text.includes(a));
  return text.includes(shortRegion(r));
}
