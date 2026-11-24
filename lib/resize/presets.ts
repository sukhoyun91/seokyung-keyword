/** 이미지 리사이징 사이즈 목록 (여러 개를 골라 동시에 작업) */
export interface SizePreset {
  key: string;
  label: string;
  w: number;
  h: number;
}

export const PRESET_GROUPS: { name: string; items: SizePreset[] }[] = [
  {
    name: '인스타그램',
    items: [
      { key: 'ig-portrait', label: '피드 세로 (4:5)', w: 1080, h: 1350 },
      { key: 'ig-square', label: '피드 정사각 (1:1)', w: 1080, h: 1080 },
      { key: 'ig-landscape', label: '피드 가로 (1.91:1)', w: 1080, h: 566 },
      { key: 'ig-story', label: '스토리·릴스 (9:16)', w: 1080, h: 1920 },
    ],
  },
  {
    name: '페이스북·카카오·블로그',
    items: [
      { key: 'fb-feed', label: '페이스북 링크·피드 (1.91:1)', w: 1200, h: 630 },
      { key: 'kakao-square', label: '카카오톡 채널 정사각', w: 800, h: 800 },
      { key: 'kakao-wide', label: '카카오톡 채널 와이드 (2:1)', w: 800, h: 400 },
      { key: 'blog-thumb', label: '블로그 대표 이미지 (1:1)', w: 1000, h: 1000 },
    ],
  },
  {
    name: '유튜브',
    items: [
      { key: 'yt-thumb', label: '썸네일 (16:9)', w: 1280, h: 720 },
      { key: 'yt-banner', label: '채널 배너', w: 2560, h: 1440 },
      { key: 'yt-shorts', label: '쇼츠 (9:16)', w: 1080, h: 1920 },
    ],
  },
  {
    name: '사이니지·모니터',
    items: [
      { key: 'sig-v-fhd', label: '세로형 FHD', w: 1080, h: 1920 },
      { key: 'sig-h-fhd', label: '가로형 FHD', w: 1920, h: 1080 },
      { key: 'sig-v-4k', label: '세로형 4K', w: 2160, h: 3840 },
      { key: 'sig-h-4k', label: '가로형 4K', w: 3840, h: 2160 },
    ],
  },
  {
    name: '웹·배너',
    items: [
      { key: 'web-main', label: '홈페이지 메인 배너', w: 1920, h: 600 },
      { key: 'web-mobile', label: '모바일 배너', w: 1080, h: 540 },
      { key: 'web-popup', label: '팝업 (세로)', w: 600, h: 800 },
      { key: 'web-square', label: '정사각 배너', w: 600, h: 600 },
    ],
  },
];

export const ALL_PRESETS: SizePreset[] = PRESET_GROUPS.flatMap((g) => g.items);
