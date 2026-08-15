# v3 추가 요구사항 기준선

Canonical artifacts:

- [`../webeditor_codex_spec_v3.txt`](../webeditor_codex_spec_v3.txt)
- [`../webeditor_v3_change_summary.txt`](../webeditor_v3_change_summary.txt)
- [`../webeditor_theme_presets_v3.json`](../webeditor_theme_presets_v3.json)
- [`../webeditor_project_corpus_v3.json`](../webeditor_project_corpus_v3.json)

## 통합된 추가 요구사항

1. Published Runtime의 Page Navigation은 항상 왼쪽에 둔다.
2. 모든 Graph Input/Target Port는 왼쪽, Output/Source Port는 오른쪽이다.
3. Page Icon은 영구 속성이며 검색 가능한 Lucide Picker로 선택한다.
4. Editor와 Runtime은 같은 Semantic Theme Token Contract를 사용한다.
5. Graph Edge는 직교 선분과 작은 Rounded Bend를 기본으로 한다.
6. Element Drop 전에 최종 Grid 위치와 크기를 정확히 미리 보인다.
7. 제공된 Manifest의 60개 Research-driven Theme를 사용한다.
8. 구현 Feature Inventory 전체를 검증하고 미검증 항목을 0으로 만든다.
9. 제공된 Corpus로 정확히 100개 Project의 실제 운용을 검증한다.
10. Project Delete는 Recycle Bin 기반 Soft Delete이며 Purge와 분리한다.

## 완료 판단

코드 존재는 `IMPLEMENTED`일 뿐이다. Inventory 전수 검증은
`EXHAUSTIVELY VERIFIED`, 100개 실제 Project 운용 검증은
`OPERATIONALLY VERIFIED`, Windows/HTTPS 배포까지 통과해야 `RELEASED`다.
