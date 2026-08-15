# 원문 요구사항 기준선

Canonical artifact: [`../source_web_server_design.txt`](../source_web_server_design.txt)

SHA-256: `f3e3a66dd57e4da7fbc49dc156f3c9b2b43c85593a9e35af3150b6d28c029896`

이 문서는 원문의 의미를 정규화한 읽기용 기준선이다. 원문 파일 자체가 최종
권위이며, 체크섬이 달라지면 Phase Gate가 실패한다.

## 제품 의도

- 통계분석 전문가가 비개발자여도 웹서비스를 쉽게 제작할 수 있는 플랫폼.
- shadcn/ui를 UI/UX의 기준으로 사용하고 일반 아이콘은 Lucide를 사용.
- 제작 흐름은 Page/Layout → Database/Element 연결 → 실제 데이터 입출력 검증.
- Theme 선택은 우상단, Font Size `- 12px +`는 그 왼쪽.
- Dark 20, Gray 20, Light 20의 가독성 높은 테마 제공.

## Page와 Layout

- Page 이름은 더블클릭으로 변경.
- Drag & Drop 순서 변경과 드래그 중 대롱거리는 시각 효과.
- Page 우측 빨간 휴지통 아이콘으로 삭제.
- 게시판, 통계 Dashboard, Chat 등 실제 Layout Preset.
- 좌측 Element Palette에서 Canvas로 Drag & Drop.
- Grid 자동 정렬, 상하좌우와 네 모서리의 8방향 Resize.
- 선택 Element의 상세 속성을 우측 Inspector에서 편집.

## Database Designer

- Class Diagram 형식.
- Page, Element, Database를 Node로 표현.
- Point-to-point Drag & Drop 연결.
- Node 자유 이동과 연결 방해를 최소화하는 Auto Layout.

## 운영 환경

- 사용자 로컬 PC에서 호스팅.
- 최종 공개 주소는 `https://webeditor.dove9999.com`.
