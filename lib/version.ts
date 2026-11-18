import pkg from '../package.json';

/** 프로그램 버전 (package.json 의 version). 화면 상단·로그인 화면에 표시 */
export const APP_VERSION: string = pkg.version;

/** Vercel 배포 시 자동으로 들어오는 커밋 번호 앞 7자리 (로컬 실행 시 빈 값) */
export const BUILD_ID: string = (process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || '').slice(0, 7);
