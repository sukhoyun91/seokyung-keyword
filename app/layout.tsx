import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '서경방송 키워드 분석',
  description: '이미지·사이트·텍스트에서 AI로 검색 키워드를 추출하고 네이버 검색량 순으로 정렬합니다.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
