# 상세페이지 편집기 글꼴 고지

이 폴더의 글꼴은 모두 SIL Open Font License 1.1(OFL) 글꼴입니다. 라이선스 전문과 저작권 표기는 `licenses/<글꼴>-OFL.txt`에 있습니다.
글꼴 파일만 따로 판매하지 않습니다. 수정본(부분 세트)도 OFL을 따르며, 예약 이름(RFN)이 있는 글꼴은 수정하지 않았습니다.

- 원본 그대로: 작성자가 배포한 woff2 바이트 그대로
- woff2 압축만: TTF를 woff2로 압축만 함(OFL FAQ 2.2 — 글꼴 자료 불변, 빌드 때 표 단위로 원본과 대조. 디지털 서명 DSIG 표는 WOFF2 규격상 빠짐)
- 부분 세트: RFN이 없는 글꼴만, 한자·가나 등 상세페이지에 쓰지 않는 문자를 뺌(한글·자모·라틴·기호는 모두 남김). 그런 문자가 원래 없는 글꼴은 서브세터만 거쳐 다시 씀(뺀 문자 0자 — 표에 글꼴마다 적음)
- 만든 스크립트: `scripts/fonts/build-pdp-fonts.py`
- 예전 문서 별칭: Cafe24 Ssurround → Jua (Cafe24 Ssurround는 라이선스 원문을 확인하지 못해 보관하지 않음)

| CSS 이름 | 파일 | 저작권 | 예약 이름 | 가공 | 출처 |
|---|---|---|---|---|---|
| Pretendard | Pretendard-Thin.woff2 | Copyright (c) 2021, Kil Hyung-jin | 'Pretendard' | 원본 그대로 | https://raw.githubusercontent.com/orioncactus/pretendard/v1.3.9/packages/pretendard/dist/web/static/woff2/Pretendard-Thin.woff2 |
| Pretendard | Pretendard-ExtraLight.woff2 | Copyright (c) 2021, Kil Hyung-jin | 'Pretendard' | 원본 그대로 | https://raw.githubusercontent.com/orioncactus/pretendard/v1.3.9/packages/pretendard/dist/web/static/woff2/Pretendard-ExtraLight.woff2 |
| Pretendard | Pretendard-Light.woff2 | Copyright (c) 2021, Kil Hyung-jin | 'Pretendard' | 원본 그대로 | https://raw.githubusercontent.com/orioncactus/pretendard/v1.3.9/packages/pretendard/dist/web/static/woff2/Pretendard-Light.woff2 |
| Pretendard | Pretendard-Regular.woff2 | Copyright (c) 2021, Kil Hyung-jin | 'Pretendard' | 원본 그대로 | https://raw.githubusercontent.com/orioncactus/pretendard/v1.3.9/packages/pretendard/dist/web/static/woff2/Pretendard-Regular.woff2 |
| Pretendard | Pretendard-Medium.woff2 | Copyright (c) 2021, Kil Hyung-jin | 'Pretendard' | 원본 그대로 | https://raw.githubusercontent.com/orioncactus/pretendard/v1.3.9/packages/pretendard/dist/web/static/woff2/Pretendard-Medium.woff2 |
| Pretendard | Pretendard-SemiBold.woff2 | Copyright (c) 2021, Kil Hyung-jin | 'Pretendard' | 원본 그대로 | https://raw.githubusercontent.com/orioncactus/pretendard/v1.3.9/packages/pretendard/dist/web/static/woff2/Pretendard-SemiBold.woff2 |
| Pretendard | Pretendard-Bold.woff2 | Copyright (c) 2021, Kil Hyung-jin | 'Pretendard' | 원본 그대로 | https://raw.githubusercontent.com/orioncactus/pretendard/v1.3.9/packages/pretendard/dist/web/static/woff2/Pretendard-Bold.woff2 |
| Pretendard | Pretendard-ExtraBold.woff2 | Copyright (c) 2021, Kil Hyung-jin | 'Pretendard' | 원본 그대로 | https://raw.githubusercontent.com/orioncactus/pretendard/v1.3.9/packages/pretendard/dist/web/static/woff2/Pretendard-ExtraBold.woff2 |
| Pretendard | Pretendard-Black.woff2 | Copyright (c) 2021, Kil Hyung-jin | 'Pretendard' | 원본 그대로 | https://raw.githubusercontent.com/orioncactus/pretendard/v1.3.9/packages/pretendard/dist/web/static/woff2/Pretendard-Black.woff2 |
| Pretendard Variable | PretendardVariable.woff2 | Copyright (c) 2021, Kil Hyung-jin | 'Pretendard' | 원본 그대로 | https://raw.githubusercontent.com/orioncactus/pretendard/v1.3.9/packages/pretendard/dist/web/variable/woff2/PretendardVariable.woff2 |
| GmarketSansBold | GmarketSansTTFBold.woff2 | Copyright © 2019 eBay Korea Co., Ltd. | 'Gmarket Sans Font' | woff2 압축만 | https://corp.gmarket.com/fonts/GmarketSansTTF.zip |
| Noto Sans KR | NotoSansKR-wght.woff2 | Copyright 2014-2021 Adobe | 'Source' | woff2 압축만 | https://raw.githubusercontent.com/google/fonts/6c1dbe27dcf7d817d4b62cec033ba77fa8e2a5ec/ofl/notosanskr/NotoSansKR%5Bwght%5D.ttf |
| Nanum Gothic | NanumGothic-Regular.woff2 | Copyright (c) 2010, NHN Corporation | Nanum, NanumGothic 등 | woff2 압축만 | https://raw.githubusercontent.com/google/fonts/6c1dbe27dcf7d817d4b62cec033ba77fa8e2a5ec/ofl/nanumgothic/NanumGothic-Regular.ttf |
| Nanum Gothic | NanumGothic-Bold.woff2 | Copyright (c) 2010, NHN Corporation | Nanum, NanumGothic 등 | woff2 압축만 | https://raw.githubusercontent.com/google/fonts/6c1dbe27dcf7d817d4b62cec033ba77fa8e2a5ec/ofl/nanumgothic/NanumGothic-Bold.ttf |
| Nanum Gothic | NanumGothic-ExtraBold.woff2 | Copyright (c) 2010, NHN Corporation | Nanum, NanumGothic 등 | woff2 압축만 | https://raw.githubusercontent.com/google/fonts/6c1dbe27dcf7d817d4b62cec033ba77fa8e2a5ec/ofl/nanumgothic/NanumGothic-ExtraBold.ttf |
| IBM Plex Sans KR | IBMPlexSansKR-Regular.woff2 | Copyright © 2017 IBM Corp. | 'Plex' | woff2 압축만 | https://raw.githubusercontent.com/google/fonts/6c1dbe27dcf7d817d4b62cec033ba77fa8e2a5ec/ofl/ibmplexsanskr/IBMPlexSansKR-Regular.ttf |
| IBM Plex Sans KR | IBMPlexSansKR-Bold.woff2 | Copyright © 2017 IBM Corp. | 'Plex' | woff2 압축만 | https://raw.githubusercontent.com/google/fonts/6c1dbe27dcf7d817d4b62cec033ba77fa8e2a5ec/ofl/ibmplexsanskr/IBMPlexSansKR-Bold.ttf |
| Gothic A1 | GothicA1-Regular.woff2 | (C) Copyright HanYang I&C Co.,Ltd. | 없음 | 부분 세트 woff2(뺀 문자 287자 — 한자·가나 등) | https://raw.githubusercontent.com/google/fonts/6c1dbe27dcf7d817d4b62cec033ba77fa8e2a5ec/ofl/gothica1/GothicA1-Regular.ttf |
| Gothic A1 | GothicA1-Bold.woff2 | (C) Copyright HanYang I&C Co.,Ltd. | 없음 | 부분 세트 woff2(뺀 문자 287자 — 한자·가나 등) | https://raw.githubusercontent.com/google/fonts/6c1dbe27dcf7d817d4b62cec033ba77fa8e2a5ec/ofl/gothica1/GothicA1-Bold.ttf |
| Gothic A1 | GothicA1-Black.woff2 | (C) Copyright HanYang I&C Co.,Ltd. | 없음 | 부분 세트 woff2(뺀 문자 287자 — 한자·가나 등) | https://raw.githubusercontent.com/google/fonts/6c1dbe27dcf7d817d4b62cec033ba77fa8e2a5ec/ofl/gothica1/GothicA1-Black.ttf |
| Gowun Dodum | GowunDodum-Regular.woff2 | Copyright 2021 The Gowun Dodum Project Authors | 없음 | 서브세터로 다시 쓴 woff2(뺀 문자 0자) | https://raw.githubusercontent.com/google/fonts/6c1dbe27dcf7d817d4b62cec033ba77fa8e2a5ec/ofl/gowundodum/GowunDodum-Regular.ttf |
| SUIT Variable | SUIT-Variable.woff2 | Copyright (c) 2022, SUNN | 'SUIT' | 원본 그대로 | https://raw.githubusercontent.com/sun-typeface/SUIT/v2.0.5/fonts/variable/woff2/SUIT-Variable.woff2 |
| Wanted Sans Variable | WantedSansVariable.woff2 | Copyright 2024 The Wanted Sans Project Authors | 'Wanted Sans Variable'(OFL.txt에는 없고 배포 CSS 머리말에 있음 — https://raw.githubusercontent.com/wanteddev/wanted-sans/v1.0.3/packages/wanted-sans/fonts/webfonts/variable/complete/WantedSansVariable.css, 보수적으로 원본 그대로) | 원본 그대로 | https://raw.githubusercontent.com/wanteddev/wanted-sans/v1.0.3/packages/wanted-sans/fonts/webfonts/variable/complete/woff2/WantedSansVariable.woff2 |
| Paperlogy | Paperlogy-4Regular.woff2 | Copyright 2024 The PAPERLOGY Authors | 없음 | 원본 그대로 | https://raw.githubusercontent.com/Freesentation/paperlogy/8ef35f53b318c7ca914c52b1b382b9a8bad07a61/woff2/Paperlogy-4Regular.woff2 |
| Paperlogy | Paperlogy-7Bold.woff2 | Copyright 2024 The PAPERLOGY Authors | 없음 | 원본 그대로 | https://raw.githubusercontent.com/Freesentation/paperlogy/8ef35f53b318c7ca914c52b1b382b9a8bad07a61/woff2/Paperlogy-7Bold.woff2 |
| Paperlogy | Paperlogy-8ExtraBold.woff2 | Copyright 2024 The PAPERLOGY Authors | 없음 | 원본 그대로 | https://raw.githubusercontent.com/Freesentation/paperlogy/8ef35f53b318c7ca914c52b1b382b9a8bad07a61/woff2/Paperlogy-8ExtraBold.woff2 |
| LINE Seed Sans KR | LINESeedKR-Rg.woff2 | © LY Corporation | 확인 못 함(zip·글꼴에 표기 없음 — 원본 그대로만 씀) | 원본 그대로 | https://seed.line.me/src/images/fonts/LINE_Seed_Sans_KR.zip |
| LINE Seed Sans KR | LINESeedKR-Bd.woff2 | © LY Corporation | 확인 못 함(zip·글꼴에 표기 없음 — 원본 그대로만 씀) | 원본 그대로 | https://seed.line.me/src/images/fonts/LINE_Seed_Sans_KR.zip |
| Nanum Myeongjo | NanumMyeongjo-Regular.woff2 | Copyright (c) 2010, NHN Corporation | Nanum, NanumMyeongjo 등 | woff2 압축만 | https://raw.githubusercontent.com/google/fonts/6c1dbe27dcf7d817d4b62cec033ba77fa8e2a5ec/ofl/nanummyeongjo/NanumMyeongjo-Regular.ttf |
| Nanum Myeongjo | NanumMyeongjo-Bold.woff2 | Copyright (c) 2010, NHN Corporation | Nanum, NanumMyeongjo 등 | woff2 압축만 | https://raw.githubusercontent.com/google/fonts/6c1dbe27dcf7d817d4b62cec033ba77fa8e2a5ec/ofl/nanummyeongjo/NanumMyeongjo-Bold.ttf |
| Noto Serif KR | NotoSerifKR-wght.woff2 | Copyright 2012 Google Inc.(OFL.txt) / (c) 2017-2024 Adobe(글꼴 name 0) | 없음 | 부분 세트 woff2(뺀 문자 9,302자 — 한자·가나 등) | https://raw.githubusercontent.com/google/fonts/6c1dbe27dcf7d817d4b62cec033ba77fa8e2a5ec/ofl/notoserifkr/NotoSerifKR%5Bwght%5D.ttf |
| Gowun Batang | GowunBatang-Regular.woff2 | Copyright 2021 The Gowun Batang Project Authors | 없음 | 서브세터로 다시 쓴 woff2(뺀 문자 0자) | https://raw.githubusercontent.com/google/fonts/6c1dbe27dcf7d817d4b62cec033ba77fa8e2a5ec/ofl/gowunbatang/GowunBatang-Regular.ttf |
| Hahmlet | Hahmlet-wght.woff2 | Copyright 2020 The Hahmlet Project Authors | 없음 | 부분 세트 woff2(뺀 문자 1자 — 한자·가나 등) | https://raw.githubusercontent.com/google/fonts/6c1dbe27dcf7d817d4b62cec033ba77fa8e2a5ec/ofl/hahmlet/Hahmlet%5Bwght%5D.ttf |
| Song Myung | SongMyung-Regular.woff2 | Copyright 2018 The SongMyung Project Authors | 없음 | 서브세터로 다시 쓴 woff2(뺀 문자 0자) | https://raw.githubusercontent.com/google/fonts/6c1dbe27dcf7d817d4b62cec033ba77fa8e2a5ec/ofl/songmyung/SongMyung-Regular.ttf |
| Black Han Sans | BlackHanSans-Regular.woff2 | Copyright 2015 The Black Han Sans Project Authors | 없음 | 서브세터로 다시 쓴 woff2(뺀 문자 0자) | https://raw.githubusercontent.com/google/fonts/6c1dbe27dcf7d817d4b62cec033ba77fa8e2a5ec/ofl/blackhansans/BlackHanSans-Regular.ttf |
| Do Hyeon | DoHyeon-Regular.woff2 | Copyright 2018 The Do Hyeon Project Authors | 없음 | 서브세터로 다시 쓴 woff2(뺀 문자 0자) | https://raw.githubusercontent.com/google/fonts/6c1dbe27dcf7d817d4b62cec033ba77fa8e2a5ec/ofl/dohyeon/DoHyeon-Regular.ttf |
| Jua | Jua-Regular.woff2 | Copyright 2018 The Jua Project Authors | 없음 | 서브세터로 다시 쓴 woff2(뺀 문자 0자) | https://raw.githubusercontent.com/google/fonts/6c1dbe27dcf7d817d4b62cec033ba77fa8e2a5ec/ofl/jua/Jua-Regular.ttf |
| Gugi | Gugi-Regular.woff2 | Copyright (c) 2017 by TAE System & Typefaces Co. | 없음 | 서브세터로 다시 쓴 woff2(뺀 문자 0자) | https://raw.githubusercontent.com/google/fonts/6c1dbe27dcf7d817d4b62cec033ba77fa8e2a5ec/ofl/gugi/Gugi-Regular.ttf |
| Nanum Pen Script | NanumPenScript-Regular.woff2 | Copyright (c) 2010, NHN Corporation | Nanum, NanumPen 등 | woff2 압축만 | https://raw.githubusercontent.com/google/fonts/6c1dbe27dcf7d817d4b62cec033ba77fa8e2a5ec/ofl/nanumpenscript/NanumPenScript-Regular.ttf |
| Gaegu | Gaegu-Regular.woff2 | Copyright 2018 The Gaegu Project Authors | 없음 | 서브세터로 다시 쓴 woff2(뺀 문자 0자) | https://raw.githubusercontent.com/google/fonts/6c1dbe27dcf7d817d4b62cec033ba77fa8e2a5ec/ofl/gaegu/Gaegu-Regular.ttf |

## 라이선스 사본 출처

- Pretendard-OFL.txt: https://raw.githubusercontent.com/orioncactus/pretendard/v1.3.9/LICENSE
- GmarketSans-OFL.txt: GmarketSansTTFBold.ttf name ID 13(zip 안에 OFL.txt 없음)
- NotoSansKR-OFL.txt: https://raw.githubusercontent.com/google/fonts/6c1dbe27dcf7d817d4b62cec033ba77fa8e2a5ec/ofl/notosanskr/OFL.txt
- NanumGothic-OFL.txt: https://raw.githubusercontent.com/google/fonts/6c1dbe27dcf7d817d4b62cec033ba77fa8e2a5ec/ofl/nanumgothic/OFL.txt
- IBMPlexSansKR-OFL.txt: https://raw.githubusercontent.com/google/fonts/6c1dbe27dcf7d817d4b62cec033ba77fa8e2a5ec/ofl/ibmplexsanskr/OFL.txt
- GothicA1-OFL.txt: https://raw.githubusercontent.com/google/fonts/6c1dbe27dcf7d817d4b62cec033ba77fa8e2a5ec/ofl/gothica1/OFL.txt
- GowunDodum-OFL.txt: https://raw.githubusercontent.com/google/fonts/6c1dbe27dcf7d817d4b62cec033ba77fa8e2a5ec/ofl/gowundodum/OFL.txt
- SUIT-OFL.txt: https://raw.githubusercontent.com/sun-typeface/SUIT/v2.0.5/LICENSE
- WantedSans-OFL.txt: https://raw.githubusercontent.com/wanteddev/wanted-sans/v1.0.3/OFL.txt
- Paperlogy-OFL.txt: https://raw.githubusercontent.com/Freesentation/paperlogy/8ef35f53b318c7ca914c52b1b382b9a8bad07a61/OFL%20license.txt
- LINESeedKR-OFL.txt: seed.line.me/index_kr.html "All fonts are released under the SIL Open Font License, Version1.1" — zip에 OFL.txt 없어 표준 본문으로 작성
- NanumMyeongjo-OFL.txt: https://raw.githubusercontent.com/google/fonts/6c1dbe27dcf7d817d4b62cec033ba77fa8e2a5ec/ofl/nanummyeongjo/OFL.txt
- NotoSerifKR-OFL.txt: https://raw.githubusercontent.com/google/fonts/6c1dbe27dcf7d817d4b62cec033ba77fa8e2a5ec/ofl/notoserifkr/OFL.txt
- GowunBatang-OFL.txt: https://raw.githubusercontent.com/google/fonts/6c1dbe27dcf7d817d4b62cec033ba77fa8e2a5ec/ofl/gowunbatang/OFL.txt
- Hahmlet-OFL.txt: https://raw.githubusercontent.com/google/fonts/6c1dbe27dcf7d817d4b62cec033ba77fa8e2a5ec/ofl/hahmlet/OFL.txt
- SongMyung-OFL.txt: https://raw.githubusercontent.com/google/fonts/6c1dbe27dcf7d817d4b62cec033ba77fa8e2a5ec/ofl/songmyung/OFL.txt
- BlackHanSans-OFL.txt: https://raw.githubusercontent.com/google/fonts/6c1dbe27dcf7d817d4b62cec033ba77fa8e2a5ec/ofl/blackhansans/OFL.txt
- DoHyeon-OFL.txt: https://raw.githubusercontent.com/google/fonts/6c1dbe27dcf7d817d4b62cec033ba77fa8e2a5ec/ofl/dohyeon/OFL.txt
- Jua-OFL.txt: https://raw.githubusercontent.com/google/fonts/6c1dbe27dcf7d817d4b62cec033ba77fa8e2a5ec/ofl/jua/OFL.txt
- Gugi-OFL.txt: https://raw.githubusercontent.com/google/fonts/6c1dbe27dcf7d817d4b62cec033ba77fa8e2a5ec/ofl/gugi/OFL.txt
- NanumPenScript-OFL.txt: https://raw.githubusercontent.com/google/fonts/6c1dbe27dcf7d817d4b62cec033ba77fa8e2a5ec/ofl/nanumpenscript/OFL.txt
- Gaegu-OFL.txt: https://raw.githubusercontent.com/google/fonts/6c1dbe27dcf7d817d4b62cec033ba77fa8e2a5ec/ofl/gaegu/OFL.txt
