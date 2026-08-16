import { randomUUID } from "node:crypto";
import { join } from "node:path";

import {
  type DataFieldType,
  type DataTableDto,
  type ElementType,
  type PageType,
  type ReferenceApplicationKind,
  type ReferenceApplicationProjectDto,
  type ReferenceApplicationSuiteDto,
} from "@webeditor/domain";
import Database from "better-sqlite3";

import type { BackupService } from "../backup/backup-service.js";
import type { RelationshipService } from "../data-relationship/relationship-service.js";
import type { SchemaService } from "../data-schema/schema-service.js";
import type { ElementService } from "../elements/element-service.js";
import { assertApi } from "../errors.js";
import type { MetadataDatabase } from "../metadata/database.js";
import type { PageService } from "../pages/page-service.js";
import type { ProjectService } from "../projects/project-service.js";

const PHYSICAL_NAME_PATTERN = /^[a-z][a-z0-9_]{0,62}$/u;

interface FieldSpec {
  readonly key: string;
  readonly label: string;
  readonly type: DataFieldType;
  readonly nullable?: boolean;
  readonly indexed?: boolean;
  readonly defaultValue?: string | null;
  readonly unit?: string | null;
}

interface TableSpec {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly fields: readonly FieldSpec[];
  readonly rowCount: number;
  readonly row: (index: number) => Readonly<Record<string, unknown>>;
}

interface RelationSpec {
  readonly label: string;
  readonly sourceTable: string;
  readonly sourceField: string;
  readonly targetTable: string;
}

interface PageSpec {
  readonly name: string;
  readonly pageType: PageType;
  readonly table: string;
  readonly metricField: string;
  readonly chart: "line-chart" | "bar-chart" | "histogram";
}

interface ReferenceApplicationDefinition {
  readonly kind: ReferenceApplicationKind;
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly themeId: string;
  readonly activityTable: string;
  readonly tables: readonly TableSpec[];
  readonly relations: readonly RelationSpec[];
  readonly pages: readonly PageSpec[];
}

interface ReferenceApplicationsServiceOptions {
  readonly metadataDatabase: MetadataDatabase;
  readonly projectService: ProjectService;
  readonly pageService: PageService;
  readonly elementService: ElementService;
  readonly schemaService: SchemaService;
  readonly relationshipService: RelationshipService;
  readonly backupService: BackupService;
  readonly clock?: () => Date;
}

interface CreatedTable {
  readonly spec: TableSpec;
  readonly table: DataTableDto;
  readonly fields: ReadonlyMap<string, DataTableDto["fields"][number]>;
}

interface CreatedApplicationBindings {
  readonly readBindingIds: readonly string[];
  readonly createBindingId: string;
  readonly updateBindingId: string;
  readonly deleteBindingId: string;
  readonly idInputElementId: string;
  readonly valueInputElementId: string;
}

function atDate(index: number, hour = 0): string {
  const day = String((index % 28) + 1).padStart(2, "0");
  return `2026-07-${day}T${String(hour % 24).padStart(2, "0")}:00:00.000Z`;
}

function table(
  key: string,
  label: string,
  description: string,
  rowCount: number,
  fields: readonly FieldSpec[],
  row: TableSpec["row"],
): TableSpec {
  return { key, label, description, rowCount, fields, row };
}

const applicationDefinitions: readonly ReferenceApplicationDefinition[] = [
  {
    kind: "SEMICONDUCTOR_YIELD",
    slug: "sample-semiconductor-yield",
    name: "반도체 수율 관리 시스템",
    description: "로트·웨이퍼·불량·품질 경보를 실제 데이터와 연결한 운영 예제",
    themeId: "dark-carbon-100",
    activityTable: "adjustments",
    tables: [
      table(
        "lots",
        "생산 로트",
        "제품별 생산 로트와 목표 수율",
        80,
        [
          { key: "product", label: "제품", type: "TEXT", indexed: true },
          { key: "line", label: "공정라인", type: "TEXT", indexed: true },
          { key: "startedAt", label: "투입시각", type: "DATETIME" },
          { key: "status", label: "상태", type: "TEXT" },
          { key: "targetYield", label: "목표수율", type: "REAL", unit: "%" },
        ],
        (index) => ({
          product: `CHIP-${(index % 6) + 1}`,
          line: `LINE-${(index % 4) + 1}`,
          startedAt: atDate(index, index),
          status: ["진행", "검사", "완료"][index % 3],
          targetYield: 92 + (index % 5) * 0.7,
        }),
      ),
      table(
        "wafers",
        "웨이퍼 결과",
        "웨이퍼 단위 수율과 불량 수",
        240,
        [
          { key: "lotId", label: "로트ID", type: "INTEGER", indexed: true },
          { key: "waferNo", label: "웨이퍼번호", type: "INTEGER" },
          { key: "yield", label: "수율", type: "REAL", unit: "%" },
          { key: "defects", label: "불량수", type: "INTEGER" },
          { key: "step", label: "공정단계", type: "TEXT" },
          { key: "measuredAt", label: "측정시각", type: "DATETIME" },
        ],
        (index) => ({
          lotId: (index % 80) + 1,
          waferNo: (index % 25) + 1,
          yield: Number((88 + ((index * 17) % 115) / 10).toFixed(2)),
          defects: (index * 7) % 43,
          step: ["노광", "식각", "증착", "검사"][index % 4],
          measuredAt: atDate(index, index * 3),
        }),
      ),
      table(
        "defects",
        "불량 이벤트",
        "좌표와 유형을 포함한 불량 이력",
        180,
        [
          { key: "waferId", label: "웨이퍼ID", type: "INTEGER", indexed: true },
          { key: "type", label: "불량유형", type: "TEXT" },
          { key: "severity", label: "심각도", type: "REAL" },
          { key: "x", label: "좌표X", type: "INTEGER" },
          { key: "y", label: "좌표Y", type: "INTEGER" },
          { key: "foundAt", label: "발견시각", type: "DATETIME" },
        ],
        (index) => ({
          waferId: (index % 240) + 1,
          type: ["Particle", "Scratch", "Bridge", "Void"][index % 4],
          severity: Number((1 + (index % 40) / 10).toFixed(1)),
          x: (index * 13) % 300,
          y: (index * 19) % 300,
          foundAt: atDate(index, index * 5),
        }),
      ),
      table(
        "alerts",
        "품질 경보",
        "수율 임계치와 해결 상태",
        60,
        [
          { key: "lotId", label: "로트ID", type: "INTEGER", indexed: true },
          { key: "level", label: "경보등급", type: "TEXT" },
          { key: "score", label: "위험점수", type: "REAL" },
          { key: "message", label: "메시지", type: "TEXT" },
          { key: "resolved", label: "해결", type: "BOOLEAN" },
          { key: "occurredAt", label: "발생시각", type: "DATETIME" },
        ],
        (index) => ({
          lotId: (index % 80) + 1,
          level: ["주의", "경고", "위험"][index % 3],
          score: 55 + (index % 45),
          message: `수율 편차 감지 ${index + 1}`,
          resolved: index % 4 === 0 ? 1 : 0,
          occurredAt: atDate(index, index * 7),
        }),
      ),
      table(
        "adjustments",
        "수율 조정 기록",
        "실제 CRUD 동작 확인용 조정 이력",
        40,
        [
          { key: "value", label: "값", type: "REAL", defaultValue: "0" },
          { key: "note", label: "메모", type: "TEXT", nullable: true },
        ],
        (index) => ({
          value: 90 + (index % 10) * 0.5,
          note: `조정 ${index + 1}`,
        }),
      ),
    ],
    relations: [
      {
        label: "로트-웨이퍼",
        sourceTable: "wafers",
        sourceField: "lotId",
        targetTable: "lots",
      },
      {
        label: "웨이퍼-불량",
        sourceTable: "defects",
        sourceField: "waferId",
        targetTable: "wafers",
      },
      {
        label: "로트-경보",
        sourceTable: "alerts",
        sourceField: "lotId",
        targetTable: "lots",
      },
    ],
    pages: [
      {
        name: "수율 현황",
        pageType: "dashboard",
        table: "wafers",
        metricField: "yield",
        chart: "line-chart",
      },
      {
        name: "불량 분석",
        pageType: "analysis",
        table: "defects",
        metricField: "severity",
        chart: "histogram",
      },
      {
        name: "품질 경보",
        pageType: "report",
        table: "alerts",
        metricField: "score",
        chart: "bar-chart",
      },
    ],
  },
  {
    kind: "COMMERCE_OPERATIONS",
    slug: "sample-commerce-operations",
    name: "쇼핑몰 운영 시스템",
    description: "상품·고객·주문·재고·결제를 실제 데이터와 연결한 운영 예제",
    themeId: "light-material-teal",
    activityTable: "adjustments",
    tables: [
      table(
        "products",
        "상품",
        "판매 상품과 가격",
        120,
        [
          { key: "name", label: "상품명", type: "TEXT", indexed: true },
          { key: "category", label: "카테고리", type: "TEXT" },
          { key: "price", label: "가격", type: "REAL", unit: "원" },
          { key: "active", label: "판매중", type: "BOOLEAN" },
        ],
        (i) => ({
          name: `상품 ${i + 1}`,
          category: ["전자", "생활", "패션", "식품"][i % 4],
          price: 9900 + (i % 30) * 1700,
          active: i % 11 === 0 ? 0 : 1,
        }),
      ),
      table(
        "customers",
        "고객",
        "회원과 등급",
        150,
        [
          { key: "name", label: "고객명", type: "TEXT" },
          { key: "grade", label: "등급", type: "TEXT" },
          { key: "joinedAt", label: "가입일", type: "DATE" },
        ],
        (i) => ({
          name: `고객 ${i + 1}`,
          grade: ["일반", "실버", "골드", "VIP"][i % 4],
          joinedAt: `2026-06-${String((i % 28) + 1).padStart(2, "0")}`,
        }),
      ),
      table(
        "orders",
        "주문",
        "고객별 주문 상태와 금액",
        240,
        [
          {
            key: "customerId",
            label: "고객ID",
            type: "INTEGER",
            indexed: true,
          },
          { key: "status", label: "주문상태", type: "TEXT" },
          { key: "amount", label: "주문금액", type: "REAL", unit: "원" },
          { key: "orderedAt", label: "주문시각", type: "DATETIME" },
        ],
        (i) => ({
          customerId: (i % 150) + 1,
          status: ["결제", "배송", "완료", "취소"][i % 4],
          amount: 15000 + (i % 70) * 2300,
          orderedAt: atDate(i, i * 2),
        }),
      ),
      table(
        "orderItems",
        "주문 상품",
        "주문별 상품 수량",
        480,
        [
          { key: "orderId", label: "주문ID", type: "INTEGER", indexed: true },
          { key: "productId", label: "상품ID", type: "INTEGER", indexed: true },
          { key: "quantity", label: "수량", type: "INTEGER" },
          { key: "lineAmount", label: "상품금액", type: "REAL", unit: "원" },
        ],
        (i) => ({
          orderId: (i % 240) + 1,
          productId: (i % 120) + 1,
          quantity: (i % 4) + 1,
          lineAmount: 9900 + (i % 30) * 1700,
        }),
      ),
      table(
        "inventory",
        "재고",
        "상품별 가용 재고",
        120,
        [
          { key: "productId", label: "상품ID", type: "INTEGER", indexed: true },
          { key: "stock", label: "재고수량", type: "INTEGER" },
          { key: "reserved", label: "예약수량", type: "INTEGER" },
          { key: "updatedAt", label: "갱신시각", type: "DATETIME" },
        ],
        (i) => ({
          productId: i + 1,
          stock: 20 + ((i * 7) % 180),
          reserved: (i * 3) % 24,
          updatedAt: atDate(i, i),
        }),
      ),
      table(
        "payments",
        "결제",
        "주문 결제 결과",
        220,
        [
          { key: "orderId", label: "주문ID", type: "INTEGER", indexed: true },
          { key: "method", label: "결제수단", type: "TEXT" },
          { key: "amount", label: "결제금액", type: "REAL", unit: "원" },
          { key: "paid", label: "성공", type: "BOOLEAN" },
        ],
        (i) => ({
          orderId: (i % 240) + 1,
          method: ["카드", "계좌", "간편결제"][i % 3],
          amount: 15000 + (i % 70) * 2300,
          paid: i % 13 === 0 ? 0 : 1,
        }),
      ),
      table(
        "adjustments",
        "재고 조정 기록",
        "실제 CRUD 동작 확인용 재고 조정",
        40,
        [
          { key: "value", label: "값", type: "REAL", defaultValue: "0" },
          { key: "note", label: "메모", type: "TEXT", nullable: true },
        ],
        (i) => ({ value: (i % 9) - 4, note: `재고 조정 ${i + 1}` }),
      ),
    ],
    relations: [
      {
        label: "고객-주문",
        sourceTable: "orders",
        sourceField: "customerId",
        targetTable: "customers",
      },
      {
        label: "주문-상품",
        sourceTable: "orderItems",
        sourceField: "orderId",
        targetTable: "orders",
      },
      {
        label: "상품-주문상품",
        sourceTable: "orderItems",
        sourceField: "productId",
        targetTable: "products",
      },
      {
        label: "상품-재고",
        sourceTable: "inventory",
        sourceField: "productId",
        targetTable: "products",
      },
      {
        label: "주문-결제",
        sourceTable: "payments",
        sourceField: "orderId",
        targetTable: "orders",
      },
    ],
    pages: [
      {
        name: "매출 현황",
        pageType: "dashboard",
        table: "orders",
        metricField: "amount",
        chart: "line-chart",
      },
      {
        name: "주문 분석",
        pageType: "data-viewer",
        table: "orderItems",
        metricField: "lineAmount",
        chart: "bar-chart",
      },
      {
        name: "재고 관리",
        pageType: "report",
        table: "inventory",
        metricField: "stock",
        chart: "histogram",
      },
    ],
  },
  {
    kind: "PERSONAL_BLOG",
    slug: "sample-personal-blog",
    name: "개인 블로그",
    description: "글·분류·댓글·조회·구독자를 실제 데이터와 연결한 콘텐츠 예제",
    themeId: "light-clean-paper",
    activityTable: "adjustments",
    tables: [
      table(
        "categories",
        "분류",
        "글 분류",
        12,
        [
          { key: "name", label: "분류명", type: "TEXT", indexed: true },
          { key: "color", label: "색상", type: "TEXT" },
        ],
        (i) => ({
          name:
            ["개발", "데이터", "일상", "책"][i % 4] +
            ` ${Math.floor(i / 4) + 1}`,
          color: ["blue", "violet", "green", "orange"][i % 4],
        }),
      ),
      table(
        "posts",
        "글",
        "게시 글과 공개 상태",
        80,
        [
          {
            key: "categoryId",
            label: "분류ID",
            type: "INTEGER",
            indexed: true,
          },
          { key: "title", label: "제목", type: "TEXT", indexed: true },
          { key: "views", label: "조회수", type: "INTEGER" },
          { key: "published", label: "공개", type: "BOOLEAN" },
          { key: "publishedAt", label: "게시시각", type: "DATETIME" },
        ],
        (i) => ({
          categoryId: (i % 12) + 1,
          title: `블로그 글 ${i + 1}`,
          views: 50 + ((i * 37) % 2400),
          published: i % 8 === 0 ? 0 : 1,
          publishedAt: atDate(i, i * 4),
        }),
      ),
      table(
        "comments",
        "댓글",
        "글별 댓글과 승인 상태",
        260,
        [
          { key: "postId", label: "글ID", type: "INTEGER", indexed: true },
          { key: "author", label: "작성자", type: "TEXT" },
          { key: "score", label: "반응점수", type: "REAL" },
          { key: "approved", label: "승인", type: "BOOLEAN" },
          { key: "createdAt", label: "작성시각", type: "DATETIME" },
        ],
        (i) => ({
          postId: (i % 80) + 1,
          author: `방문자 ${i + 1}`,
          score: (i % 5) + 1,
          approved: i % 10 === 0 ? 0 : 1,
          createdAt: atDate(i, i * 3),
        }),
      ),
      table(
        "pageViews",
        "페이지 조회",
        "유입 경로와 체류 시간",
        500,
        [
          { key: "postId", label: "글ID", type: "INTEGER", indexed: true },
          { key: "source", label: "유입경로", type: "TEXT" },
          { key: "duration", label: "체류시간", type: "REAL", unit: "초" },
          { key: "viewedAt", label: "조회시각", type: "DATETIME" },
        ],
        (i) => ({
          postId: (i % 80) + 1,
          source: ["검색", "직접", "SNS", "구독"][i % 4],
          duration: 18 + ((i * 11) % 420),
          viewedAt: atDate(i, i * 5),
        }),
      ),
      table(
        "subscribers",
        "구독자",
        "구독 상태",
        120,
        [
          { key: "email", label: "이메일", type: "TEXT", indexed: true },
          { key: "active", label: "구독중", type: "BOOLEAN" },
          { key: "joinedAt", label: "구독일", type: "DATE" },
        ],
        (i) => ({
          email: `reader${i + 1}@example.com`,
          active: i % 9 === 0 ? 0 : 1,
          joinedAt: `2026-05-${String((i % 28) + 1).padStart(2, "0")}`,
        }),
      ),
      table(
        "adjustments",
        "방문 기록",
        "실제 CRUD 동작 확인용 방문 기록",
        40,
        [
          { key: "value", label: "값", type: "REAL", defaultValue: "0" },
          { key: "note", label: "메모", type: "TEXT", nullable: true },
        ],
        (i) => ({ value: 30 + i * 2, note: `방문 기록 ${i + 1}` }),
      ),
    ],
    relations: [
      {
        label: "분류-글",
        sourceTable: "posts",
        sourceField: "categoryId",
        targetTable: "categories",
      },
      {
        label: "글-댓글",
        sourceTable: "comments",
        sourceField: "postId",
        targetTable: "posts",
      },
      {
        label: "글-조회",
        sourceTable: "pageViews",
        sourceField: "postId",
        targetTable: "posts",
      },
    ],
    pages: [
      {
        name: "콘텐츠 현황",
        pageType: "dashboard",
        table: "posts",
        metricField: "views",
        chart: "bar-chart",
      },
      {
        name: "댓글 관리",
        pageType: "data-viewer",
        table: "comments",
        metricField: "score",
        chart: "histogram",
      },
      {
        name: "방문 분석",
        pageType: "analysis",
        table: "pageViews",
        metricField: "duration",
        chart: "line-chart",
      },
    ],
  },
  {
    kind: "WORK_MANAGEMENT",
    slug: "sample-work-management",
    name: "업무 관리 시스템",
    description:
      "구성원·프로젝트·업무·댓글·시간 기록을 실제 데이터와 연결한 협업 예제",
    themeId: "gray-cool-steel",
    activityTable: "adjustments",
    tables: [
      table(
        "members",
        "구성원",
        "팀 구성원과 역할",
        32,
        [
          { key: "name", label: "이름", type: "TEXT" },
          { key: "role", label: "역할", type: "TEXT" },
          { key: "capacity", label: "가용시간", type: "REAL", unit: "시간" },
        ],
        (i) => ({
          name: `구성원 ${i + 1}`,
          role: ["기획", "개발", "디자인", "운영"][i % 4],
          capacity: 24 + (i % 4) * 4,
        }),
      ),
      table(
        "projects",
        "업무 프로젝트",
        "프로젝트 진행 상태",
        24,
        [
          { key: "ownerId", label: "담당자ID", type: "INTEGER", indexed: true },
          { key: "name", label: "프로젝트명", type: "TEXT" },
          { key: "progress", label: "진척률", type: "REAL", unit: "%" },
          { key: "dueDate", label: "마감일", type: "DATE" },
        ],
        (i) => ({
          ownerId: (i % 32) + 1,
          name: `업무 프로젝트 ${i + 1}`,
          progress: (i * 13) % 101,
          dueDate: `2026-09-${String((i % 28) + 1).padStart(2, "0")}`,
        }),
      ),
      table(
        "tasks",
        "업무",
        "담당자별 업무와 우선순위",
        300,
        [
          {
            key: "projectId",
            label: "프로젝트ID",
            type: "INTEGER",
            indexed: true,
          },
          {
            key: "assigneeId",
            label: "담당자ID",
            type: "INTEGER",
            indexed: true,
          },
          { key: "title", label: "업무명", type: "TEXT" },
          { key: "status", label: "상태", type: "TEXT" },
          { key: "priority", label: "우선순위", type: "REAL" },
          { key: "estimate", label: "예상시간", type: "REAL", unit: "시간" },
        ],
        (i) => ({
          projectId: (i % 24) + 1,
          assigneeId: (i % 32) + 1,
          title: `업무 ${i + 1}`,
          status: ["대기", "진행", "검토", "완료"][i % 4],
          priority: (i % 5) + 1,
          estimate: 1 + (i % 16) * 0.5,
        }),
      ),
      table(
        "comments",
        "업무 댓글",
        "업무별 협업 기록",
        320,
        [
          { key: "taskId", label: "업무ID", type: "INTEGER", indexed: true },
          {
            key: "memberId",
            label: "구성원ID",
            type: "INTEGER",
            indexed: true,
          },
          { key: "length", label: "댓글길이", type: "INTEGER" },
          { key: "createdAt", label: "작성시각", type: "DATETIME" },
        ],
        (i) => ({
          taskId: (i % 300) + 1,
          memberId: (i % 32) + 1,
          length: 20 + ((i * 17) % 360),
          createdAt: atDate(i, i * 2),
        }),
      ),
      table(
        "timeEntries",
        "시간 기록",
        "업무별 실제 투입 시간",
        240,
        [
          { key: "taskId", label: "업무ID", type: "INTEGER", indexed: true },
          {
            key: "memberId",
            label: "구성원ID",
            type: "INTEGER",
            indexed: true,
          },
          { key: "hours", label: "투입시간", type: "REAL", unit: "시간" },
          { key: "workedAt", label: "작업일", type: "DATE" },
        ],
        (i) => ({
          taskId: (i % 300) + 1,
          memberId: (i % 32) + 1,
          hours: 0.5 + (i % 12) * 0.5,
          workedAt: `2026-07-${String((i % 28) + 1).padStart(2, "0")}`,
        }),
      ),
      table(
        "adjustments",
        "업무 시간 조정",
        "실제 CRUD 동작 확인용 시간 조정",
        40,
        [
          { key: "value", label: "값", type: "REAL", defaultValue: "0" },
          { key: "note", label: "메모", type: "TEXT", nullable: true },
        ],
        (i) => ({ value: 0.5 + (i % 12) * 0.5, note: `시간 조정 ${i + 1}` }),
      ),
    ],
    relations: [
      {
        label: "구성원-프로젝트",
        sourceTable: "projects",
        sourceField: "ownerId",
        targetTable: "members",
      },
      {
        label: "프로젝트-업무",
        sourceTable: "tasks",
        sourceField: "projectId",
        targetTable: "projects",
      },
      {
        label: "구성원-업무",
        sourceTable: "tasks",
        sourceField: "assigneeId",
        targetTable: "members",
      },
      {
        label: "업무-댓글",
        sourceTable: "comments",
        sourceField: "taskId",
        targetTable: "tasks",
      },
      {
        label: "업무-시간",
        sourceTable: "timeEntries",
        sourceField: "taskId",
        targetTable: "tasks",
      },
    ],
    pages: [
      {
        name: "업무 현황",
        pageType: "dashboard",
        table: "tasks",
        metricField: "estimate",
        chart: "bar-chart",
      },
      {
        name: "팀 업무량",
        pageType: "analysis",
        table: "projects",
        metricField: "progress",
        chart: "histogram",
      },
      {
        name: "시간 분석",
        pageType: "report",
        table: "timeEntries",
        metricField: "hours",
        chart: "line-chart",
      },
    ],
  },
];

function identifier(value: string): string {
  assertApi(
    PHYSICAL_NAME_PATTERN.test(value),
    500,
    "REFERENCE_APPLICATION_IDENTIFIER_INVALID",
    "Generated runtime identifier is invalid",
  );
  return `"${value}"`;
}

export class ReferenceApplicationsService {
  readonly #clock: () => Date;

  constructor(readonly options: ReferenceApplicationsServiceOptions) {
    this.#clock = options.clock ?? (() => new Date());
  }

  async createSuite(): Promise<ReferenceApplicationSuiteDto> {
    const projects: ReferenceApplicationProjectDto[] = [];
    for (const definition of applicationDefinitions) {
      projects.push(await this.#createApplication(definition));
    }
    return {
      projects,
      totalProjectCount: 4,
      totalTestRowCount: projects.reduce(
        (sum, item) => sum + item.testRowCount,
        0,
      ),
      totalProductionRowCount: projects.reduce(
        (sum, item) => sum + item.productionRowCount,
        0,
      ),
      status: "READY",
    };
  }

  async #createApplication(
    definition: ReferenceApplicationDefinition,
  ): Promise<ReferenceApplicationProjectDto> {
    const existing = this.options.projectService
      .listActive()
      .find(({ slug }) => slug === definition.slug);
    if (existing !== undefined) return this.#dto(definition, existing.id);

    const project = this.options.projectService.create({
      name: definition.name,
      slug: definition.slug,
      description: definition.description,
      themeId: definition.themeId,
      favorite: true,
    });
    const tables = this.#createSchema(definition, project.id);
    this.#writeRows(project.id, "test", tables);
    const bindings = await this.#createPagesAndBindings(
      definition,
      project.id,
      tables,
    );
    const graph = this.options.relationshipService.graph(project.id);
    const preview = await this.options.relationshipService.previewAutoLayout(
      project.id,
      {
        action: "PREVIEW",
        expectedGraphRevision: graph.graphRevision,
        expectedProjectRevision: graph.projectRevision,
      },
    );
    const layout = this.options.relationshipService.applyAutoLayout(
      project.id,
      {
        action: "APPLY",
        previewId: preview.previewId,
        expectedGraphRevision: preview.graphRevision,
        expectedProjectRevision: preview.projectRevision,
        idempotencyKey: `${definition.slug}-auto-layout-v1`,
      },
    );
    const published = this.options.pageService.publish(project.id, {
      expectedProjectRevision: layout.projectRevision,
      idempotencyKey: `${definition.slug}-publish-v1`,
    });
    this.#writeRows(project.id, "production", tables);
    for (const bindingId of bindings.readBindingIds.slice(0, 3)) {
      const result = this.options.relationshipService.executeRuntimeBinding(
        project.id,
        bindingId,
        {},
      );
      assertApi(
        result.result.rowCount > 0,
        500,
        "REFERENCE_APPLICATION_RUNTIME_EMPTY",
        "Published sample binding returned no rows",
        { kind: definition.kind, bindingId },
      );
    }
    const inserted = this.options.relationshipService.executeRuntimeMutation(
      project.id,
      bindings.createBindingId,
      "CREATE",
      {
        values: { [bindings.valueInputElementId]: 61.5 },
        idempotencyKey: `${definition.slug}-production-create-check`,
      },
    );
    assertApi(
      typeof inserted.insertedPrimaryKey === "number",
      500,
      "REFERENCE_APPLICATION_CRUD_FAILED",
      "Published CREATE did not return an ID",
    );
    this.options.relationshipService.executeRuntimeMutation(
      project.id,
      bindings.updateBindingId,
      "UPDATE",
      {
        values: {
          [bindings.idInputElementId]: inserted.insertedPrimaryKey,
          [bindings.valueInputElementId]: 73.25,
        },
        idempotencyKey: `${definition.slug}-production-update-check`,
      },
    );
    this.options.relationshipService.executeRuntimeMutation(
      project.id,
      bindings.deleteBindingId,
      "DELETE",
      {
        values: { [bindings.idInputElementId]: inserted.insertedPrimaryKey },
        idempotencyKey: `${definition.slug}-production-delete-check`,
      },
    );
    const backup = this.options.backupService.create(project.id, {
      expectedRevision: published.projectRevision,
      idempotencyKey: `${definition.slug}-backup-v1`,
      label: `${definition.name} 초기 데이터`,
    });
    const drill = this.options.backupService.verify(backup.id, {
      idempotencyKey: `${definition.slug}-backup-verify-v1`,
    });
    assertApi(
      drill.status === "PASS",
      500,
      "REFERENCE_APPLICATION_BACKUP_FAILED",
      "Reference application backup verification failed",
      { kind: definition.kind },
    );
    return this.#dto(definition, project.id);
  }

  #createSchema(
    definition: ReferenceApplicationDefinition,
    projectId: string,
  ): ReadonlyMap<string, CreatedTable> {
    let schema = this.options.schemaService.schema(projectId);
    const created = new Map<string, CreatedTable>();
    for (const spec of definition.tables) {
      schema = this.options.schemaService.createTable(projectId, {
        displayName: spec.label,
        description: spec.description,
        template: "BLANK",
        expectedSchemaRevision: schema.schemaRevision,
        expectedProjectRevision: schema.projectRevision,
        idempotencyKey: `${definition.slug}-table-${spec.key}`,
      });
      let current = schema.tables.find(
        ({ displayName }) => displayName === spec.label,
      );
      assertApi(
        current !== undefined,
        500,
        "REFERENCE_APPLICATION_TABLE_MISSING",
        "Reference table was not created",
      );
      const idField = current.fields[0];
      assertApi(
        idField !== undefined,
        500,
        "REFERENCE_APPLICATION_ID_MISSING",
        "Reference table ID field is missing",
      );
      schema = this.options.schemaService.patchField(idField.id, {
        displayName: "ID",
        type: "INTEGER",
        primaryKey: true,
        autoIncrement: true,
        nullable: false,
        unique: true,
        indexed: true,
        expectedRevision: idField.revision,
        expectedSchemaRevision: schema.schemaRevision,
        expectedProjectRevision: schema.projectRevision,
        idempotencyKey: `${definition.slug}-field-${spec.key}-id`,
      });
      current = schema.tables.find(
        ({ displayName }) => displayName === spec.label,
      );
      assertApi(
        current !== undefined,
        500,
        "REFERENCE_APPLICATION_TABLE_MISSING",
        "Reference table disappeared",
      );
      for (const field of spec.fields) {
        schema = this.options.schemaService.createField(current.id, {
          displayName: field.label,
          type: field.type,
          nullable: field.nullable ?? false,
          indexed: field.indexed ?? false,
          defaultValue: field.defaultValue ?? null,
          unit: field.unit ?? null,
          description: `${definition.name} · ${spec.label}`,
          expectedSchemaRevision: schema.schemaRevision,
          expectedProjectRevision: schema.projectRevision,
          idempotencyKey: `${definition.slug}-field-${spec.key}-${field.key}`,
        });
        current = schema.tables.find(
          ({ displayName }) => displayName === spec.label,
        );
        assertApi(
          current !== undefined,
          500,
          "REFERENCE_APPLICATION_TABLE_MISSING",
          "Reference table disappeared while adding fields",
        );
      }
    }

    for (const relation of definition.relations) {
      const sourceSpec = definition.tables.find(
        ({ key }) => key === relation.sourceTable,
      );
      const targetSpec = definition.tables.find(
        ({ key }) => key === relation.targetTable,
      );
      const source = schema.tables.find(
        ({ displayName }) => displayName === sourceSpec?.label,
      );
      const target = schema.tables.find(
        ({ displayName }) => displayName === targetSpec?.label,
      );
      const sourceFieldSpec = sourceSpec?.fields.find(
        ({ key }) => key === relation.sourceField,
      );
      const sourceField = source?.fields.find(
        ({ displayName }) => displayName === sourceFieldSpec?.label,
      );
      const targetField = target?.fields.find(
        ({ displayName }) => displayName === "ID",
      );
      assertApi(
        source !== undefined &&
          target !== undefined &&
          sourceField !== undefined &&
          targetField !== undefined,
        500,
        "REFERENCE_APPLICATION_RELATION_ENDPOINT_MISSING",
        "Reference relation endpoint is missing",
        { relation: relation.label },
      );
      schema = this.options.schemaService.createRelation(projectId, {
        displayName: relation.label,
        type: "MANY_TO_ONE",
        sourceTableId: source.id,
        sourceFieldId: sourceField.id,
        targetTableId: target.id,
        targetFieldId: targetField.id,
        onDelete: "RESTRICT",
        expectedSchemaRevision: schema.schemaRevision,
        expectedProjectRevision: schema.projectRevision,
        idempotencyKey: `${definition.slug}-relation-${relation.sourceTable}-${relation.targetTable}`,
      });
    }
    const plan = this.options.schemaService.plan(projectId, {
      expectedSchemaRevision: schema.schemaRevision,
      expectedProjectRevision: schema.projectRevision,
    }).plan;
    schema = this.options.schemaService.apply(projectId, {
      planId: plan.id,
      expectedSchemaRevision: schema.schemaRevision,
      expectedProjectRevision: schema.projectRevision,
      confirmDestructive: false,
      idempotencyKey: `${definition.slug}-schema-apply-v1`,
    }).schema;
    for (const spec of definition.tables) {
      const current = schema.tables.find(
        ({ displayName }) => displayName === spec.label,
      );
      assertApi(
        current !== undefined,
        500,
        "REFERENCE_APPLICATION_TABLE_MISSING",
        "Applied reference table is missing",
      );
      created.set(spec.key, {
        spec,
        table: current,
        fields: new Map([
          [
            "id",
            current.fields.find(
              ({ displayName }) => displayName === "ID",
            ) as DataTableDto["fields"][number],
          ],
          ...spec.fields.map(
            (field) =>
              [
                field.key,
                current.fields.find(
                  ({ displayName }) => displayName === field.label,
                ) as DataTableDto["fields"][number],
              ] as const,
          ),
        ]),
      });
    }
    return created;
  }

  #writeRows(
    projectId: string,
    environment: "test" | "production",
    tables: ReadonlyMap<string, CreatedTable>,
  ): void {
    const path = join(
      this.options.projectService.storage.activePath(projectId),
      `${environment}.sqlite`,
    );
    const database = new Database(path, { fileMustExist: true });
    try {
      database.pragma("foreign_keys = ON");
      database.pragma("trusted_schema = OFF");
      database
        .transaction(() => {
          for (const { spec, table: dataTable, fields } of tables.values()) {
            const currentCount = (
              database
                .prepare(
                  `SELECT count(*) AS count FROM ${identifier(dataTable.physicalName)}`,
                )
                .get() as { readonly count: number }
            ).count;
            assertApi(
              currentCount === 0 || currentCount === spec.rowCount,
              409,
              "REFERENCE_APPLICATION_RUNTIME_ROWS_CONFLICT",
              "Reference runtime data has an unexpected row count",
              {
                environment,
                table: spec.label,
                currentCount,
                expected: spec.rowCount,
              },
            );
            if (currentCount === spec.rowCount) continue;
            const orderedFields = [
              fields.get("id"),
              ...spec.fields.map(({ key }) => fields.get(key)),
            ];
            assertApi(
              orderedFields.every((field) => field !== undefined),
              500,
              "REFERENCE_APPLICATION_FIELD_MISSING",
              "Reference runtime field is missing",
            );
            const statement = database.prepare(
              `INSERT INTO ${identifier(dataTable.physicalName)} (${orderedFields
                .map((field) =>
                  identifier(
                    (field as DataTableDto["fields"][number]).physicalName,
                  ),
                )
                .join(
                  ", ",
                )}) VALUES (${orderedFields.map(() => "?").join(", ")})`,
            );
            for (let index = 0; index < spec.rowCount; index += 1) {
              const row = spec.row(index);
              statement.run(
                index + 1,
                ...spec.fields.map(({ key }) => row[key] ?? null),
              );
            }
          }
        })
        .immediate();
      assertApi(
        database.pragma("quick_check", { simple: true }) === "ok" &&
          (database.pragma("foreign_key_check") as readonly unknown[])
            .length === 0,
        500,
        "REFERENCE_APPLICATION_RUNTIME_INTEGRITY_FAILED",
        "Reference runtime rows failed integrity checks",
        { environment },
      );
      database.pragma("wal_checkpoint(TRUNCATE)");
    } finally {
      database.close();
    }
    this.options.metadataDatabase.connection
      .prepare(
        `INSERT INTO audit_logs (
           id, project_id, action, object_type, object_id, before_json,
           after_json, correlation_id, created_at
         ) VALUES (?, ?, 'REFERENCE_APPLICATION_ROWS_SEEDED', 'PROJECT', ?, NULL, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        projectId,
        projectId,
        JSON.stringify({
          environment,
          rowCount: [...tables.values()].reduce(
            (sum, item) => sum + item.spec.rowCount,
            0,
          ),
        }),
        `reference-applications:${environment}`,
        this.#clock().toISOString(),
      );
  }

  async #createPagesAndBindings(
    definition: ReferenceApplicationDefinition,
    projectId: string,
    tables: ReadonlyMap<string, CreatedTable>,
  ): Promise<CreatedApplicationBindings> {
    const bindingIds: string[] = [];
    for (const [index, pageSpec] of definition.pages.entries()) {
      const project = this.options.projectService.getActive(projectId);
      const createdPage = this.options.pageService.create(projectId, {
        name: pageSpec.name,
        pageType: pageSpec.pageType,
        expectedProjectRevision: project.revision,
        idempotencyKey: `${definition.slug}-page-${index + 1}`,
      }).page;
      const heading = this.#createElement(
        definition,
        projectId,
        createdPage.id,
        "heading",
        `${pageSpec.name} 제목`,
        {
          "general.text": pageSpec.name,
        },
      );
      void heading;
      const kpi = this.#createElement(
        definition,
        projectId,
        createdPage.id,
        "kpi-card",
        `${pageSpec.name} 평균`,
        {
          "general.label": `${pageSpec.name} 평균`,
          "data.suffix": pageSpec.metricField === "yield" ? "%" : "",
        },
      );
      const chart = this.#createElement(
        definition,
        projectId,
        createdPage.id,
        pageSpec.chart,
        `${pageSpec.name} 차트`,
        {
          "general.title": `${pageSpec.name} 추이`,
        },
      );
      const dataTable = this.#createElement(
        definition,
        projectId,
        createdPage.id,
        "data-table",
        `${pageSpec.name} 목록`,
        {
          "general.title": `${pageSpec.name} 데이터`,
        },
      );
      const source = tables.get(pageSpec.table);
      assertApi(
        source !== undefined,
        500,
        "REFERENCE_APPLICATION_TABLE_MISSING",
        "Page source table is missing",
      );
      const metric = source.fields.get(pageSpec.metricField);
      const id = source.fields.get("id");
      assertApi(
        metric !== undefined && id !== undefined,
        500,
        "REFERENCE_APPLICATION_FIELD_MISSING",
        "Page metric field is missing",
      );
      bindingIds.push(
        this.#createReadBinding(
          definition,
          projectId,
          source,
          dataTable.element.id,
          "rows",
          "ROWS",
          id.id,
          null,
        ),
        this.#createReadBinding(
          definition,
          projectId,
          source,
          kpi.element.id,
          "value",
          "SCALAR",
          id.id,
          metric.id,
        ),
        this.#createReadBinding(
          definition,
          projectId,
          source,
          chart.element.id,
          pageSpec.chart === "histogram" ? "values" : "series",
          pageSpec.chart === "histogram" ? "VALUES" : "SERIES",
          id.id,
          metric.id,
        ),
      );
    }

    const project = this.options.projectService.getActive(projectId);
    const actionPage = this.options.pageService.create(projectId, {
      name: "실행 테스트",
      pageType: "form",
      expectedProjectRevision: project.revision,
      idempotencyKey: `${definition.slug}-page-actions`,
    }).page;
    this.#createElement(
      definition,
      projectId,
      actionPage.id,
      "heading",
      "실행 테스트 제목",
      {
        "general.text": "실행 테스트",
      },
    );
    const idInput = this.#createElement(
      definition,
      projectId,
      actionPage.id,
      "number-input",
      "기록 ID",
      {
        "general.label": "기록 ID",
      },
    );
    const valueInput = this.#createElement(
      definition,
      projectId,
      actionPage.id,
      "number-input",
      "입력 값",
      {
        "general.label": "입력 값",
      },
    );
    const createButton = this.#createElement(
      definition,
      projectId,
      actionPage.id,
      "button",
      "기록 추가",
      {
        "general.label": "추가",
      },
    );
    const updateButton = this.#createElement(
      definition,
      projectId,
      actionPage.id,
      "button",
      "기록 수정",
      {
        "general.label": "수정",
      },
    );
    const deleteButton = this.#createElement(
      definition,
      projectId,
      actionPage.id,
      "button",
      "기록 삭제",
      {
        "general.label": "삭제",
      },
    );
    const dataTable = this.#createElement(
      definition,
      projectId,
      actionPage.id,
      "data-table",
      "실행 기록",
      {
        "general.title": "실행 기록",
      },
    );
    const activity = tables.get(definition.activityTable);
    const activityId = activity?.fields.get("id");
    const activityValue = activity?.fields.get("value");
    assertApi(
      activity !== undefined &&
        activityId !== undefined &&
        activityValue !== undefined,
      500,
      "REFERENCE_APPLICATION_ACTIVITY_MISSING",
      "Activity table is incomplete",
    );
    bindingIds.push(
      this.#createReadBinding(
        definition,
        projectId,
        activity,
        dataTable.element.id,
        "rows",
        "ROWS",
        activityId.id,
        null,
      ),
    );
    const createBinding = this.#createMutationBinding(
      definition,
      projectId,
      activity,
      createButton.element.id,
      "CREATE",
      [{ fieldId: activityValue.id, inputElementId: valueInput.element.id }],
    );
    const updateBinding = this.#createMutationBinding(
      definition,
      projectId,
      activity,
      updateButton.element.id,
      "UPDATE",
      [
        { fieldId: activityId.id, inputElementId: idInput.element.id },
        { fieldId: activityValue.id, inputElementId: valueInput.element.id },
      ],
    );
    const deleteBinding = this.#createMutationBinding(
      definition,
      projectId,
      activity,
      deleteButton.element.id,
      "DELETE",
      [{ fieldId: activityId.id, inputElementId: idInput.element.id }],
    );
    const preview = this.options.pageService.createDraftPreview(
      projectId,
      this.options.projectService.getActive(projectId).revision,
    );
    const inserted =
      this.options.relationshipService.executeDraftRuntimeMutation(
        preview.previewId,
        createBinding,
        "CREATE",
        {
          values: { [valueInput.element.id]: 77.7 },
          idempotencyKey: `${definition.slug}-draft-create-check`,
        },
      );
    assertApi(
      typeof inserted.insertedPrimaryKey === "number",
      500,
      "REFERENCE_APPLICATION_CRUD_FAILED",
      "Draft CREATE did not return an ID",
    );
    this.options.relationshipService.executeDraftRuntimeMutation(
      preview.previewId,
      updateBinding,
      "UPDATE",
      {
        values: {
          [idInput.element.id]: inserted.insertedPrimaryKey,
          [valueInput.element.id]: 88.8,
        },
        idempotencyKey: `${definition.slug}-draft-update-check`,
      },
    );
    this.options.relationshipService.executeDraftRuntimeMutation(
      preview.previewId,
      deleteBinding,
      "DELETE",
      {
        values: { [idInput.element.id]: inserted.insertedPrimaryKey },
        idempotencyKey: `${definition.slug}-draft-delete-check`,
      },
    );
    return {
      readBindingIds: bindingIds,
      createBindingId: createBinding,
      updateBindingId: updateBinding,
      deleteBindingId: deleteBinding,
      idInputElementId: idInput.element.id,
      valueInputElementId: valueInput.element.id,
    };
  }

  #createElement(
    definition: ReferenceApplicationDefinition,
    projectId: string,
    pageId: string,
    elementType: ElementType,
    name: string,
    values: Readonly<Record<string, string>>,
  ) {
    const listing = this.options.elementService.list(pageId);
    const created = this.options.elementService.create(pageId, {
      elementType,
      expectedLayoutRevision: listing.layoutRevision,
      expectedProjectRevision:
        this.options.projectService.getActive(projectId).revision,
      idempotencyKey: `${definition.slug}-element-${pageId}-${listing.elements.length + 1}`,
    });
    return this.options.elementService.patch(created.entry.element.id, {
      expectedRevision: created.entry.element.revision,
      expectedLayoutRevision: created.layoutRevision,
      expectedProjectRevision: created.projectRevision,
      idempotencyKey: `${definition.slug}-element-properties-${created.entry.element.id}`,
      change: {
        kind: "PROPERTIES",
        values: { "general.displayName": name, ...values },
      },
    }).entry;
  }

  #createReadBinding(
    definition: ReferenceApplicationDefinition,
    projectId: string,
    source: CreatedTable,
    targetElementId: string,
    targetRole: string,
    shape: "ROWS" | "SCALAR" | "SERIES" | "VALUES",
    labelFieldId: string,
    valueFieldId: string | null,
  ): string {
    const graph = this.options.relationshipService.graph(projectId);
    const sourcePort = graph.nodes
      .find(({ objectId }) => objectId === source.table.id)
      ?.ports.find(
        (port) =>
          port.direction === "output" &&
          port.objectId === (valueFieldId ?? labelFieldId),
      );
    const targetPort = graph.nodes
      .find(({ objectId }) => objectId === targetElementId)
      ?.ports.find(
        (port) => port.direction === "input" && port.role === targetRole,
      );
    assertApi(
      sourcePort !== undefined && targetPort !== undefined,
      500,
      "REFERENCE_APPLICATION_BINDING_PORT_MISSING",
      "Reference READ binding port is missing",
    );
    const connection = this.options.relationshipService.preview(projectId, {
      sourcePortId: sourcePort.id,
      targetPortId: targetPort.id,
      expectedGraphRevision: graph.graphRevision,
      expectedProjectRevision: graph.projectRevision,
    });
    const aggregate =
      shape === "SCALAR"
        ? { function: "AVG" as const, fieldId: valueFieldId }
        : null;
    const query = this.options.relationshipService.previewBindingQuery(
      projectId,
      {
        connectionPreviewId: connection.previewId,
        spec: {
          mode:
            shape === "SCALAR"
              ? "AGGREGATE"
              : shape === "SERIES"
                ? "CHART_SERIES"
                : "LIST",
          selectFieldIds:
            shape === "ROWS"
              ? source.table.fields.map(({ id }) => id)
              : [labelFieldId, valueFieldId].filter(
                  (id): id is string => id !== null,
                ),
          filters: [],
          orderBy: [{ fieldId: labelFieldId, direction: "ASC" }],
          aggregate,
          groupByFieldId: null,
          limit: shape === "ROWS" ? 100 : 500,
        },
        mapping: {
          shape,
          labelFieldId:
            shape === "ROWS" || shape === "VALUES" || shape === "SCALAR"
              ? null
              : labelFieldId,
          valueFieldId,
          secondaryFieldId: null,
        },
        expectedGraphRevision: connection.graphRevision,
        expectedProjectRevision: connection.projectRevision,
      },
    );
    return this.options.relationshipService.create(projectId, {
      previewId: connection.previewId,
      queryPreviewId: query.queryPreviewId,
      bindingType: "READ",
      expectedGraphRevision: query.graphRevision,
      expectedProjectRevision: query.projectRevision,
      idempotencyKey: `${definition.slug}-read-${targetElementId}`,
    }).binding.id;
  }

  #createMutationBinding(
    definition: ReferenceApplicationDefinition,
    projectId: string,
    target: CreatedTable,
    sourceElementId: string,
    bindingType: "CREATE" | "UPDATE" | "DELETE",
    fieldMappings: readonly {
      readonly fieldId: string;
      readonly inputElementId: string;
    }[],
  ): string {
    const graph = this.options.relationshipService.graph(projectId);
    const sourcePort = graph.nodes
      .find(({ objectId }) => objectId === sourceElementId)
      ?.ports.find(
        (port) =>
          port.direction === "output" &&
          port.allowedBindingTypes.includes(bindingType),
      );
    const targetPort = graph.nodes
      .find(({ objectId }) => objectId === target.table.id)
      ?.ports.find(
        (port) =>
          port.direction === "input" &&
          port.role === "record" &&
          port.allowedBindingTypes.includes(bindingType),
      );
    assertApi(
      sourcePort !== undefined && targetPort !== undefined,
      500,
      "REFERENCE_APPLICATION_BINDING_PORT_MISSING",
      "Reference mutation binding port is missing",
    );
    const preview = this.options.relationshipService.preview(projectId, {
      sourcePortId: sourcePort.id,
      targetPortId: targetPort.id,
      expectedGraphRevision: graph.graphRevision,
      expectedProjectRevision: graph.projectRevision,
    });
    return this.options.relationshipService.create(projectId, {
      previewId: preview.previewId,
      bindingType,
      mutation: { fieldMappings },
      expectedGraphRevision: preview.graphRevision,
      expectedProjectRevision: preview.projectRevision,
      idempotencyKey: `${definition.slug}-${bindingType.toLowerCase()}-${sourceElementId}`,
    }).binding.id;
  }

  #rowCount(
    projectId: string,
    environment: "test" | "production",
    tables: readonly DataTableDto[],
  ): number {
    const database = new Database(
      join(
        this.options.projectService.storage.activePath(projectId),
        `${environment}.sqlite`,
      ),
      { readonly: true, fileMustExist: true },
    );
    try {
      return tables.reduce(
        (sum, dataTable) =>
          sum +
          (
            database
              .prepare(
                `SELECT count(*) AS count FROM ${identifier(dataTable.physicalName)}`,
              )
              .get() as { readonly count: number }
          ).count,
        0,
      );
    } finally {
      database.close();
    }
  }

  #dto(
    definition: ReferenceApplicationDefinition,
    projectId: string,
  ): ReferenceApplicationProjectDto {
    const project = this.options.projectService.getActive(projectId);
    const pages = this.options.pageService.list(projectId).pages;
    const elements = pages.flatMap(
      (page) => this.options.elementService.list(page.id).elements,
    );
    const schema = this.options.schemaService.schema(projectId);
    const graph = this.options.relationshipService.graph(projectId);
    const version = this.options.metadataDatabase.connection
      .prepare(
        "SELECT id FROM project_versions WHERE project_id = ? ORDER BY sequence DESC LIMIT 1",
      )
      .get(projectId) as { readonly id: string } | undefined;
    assertApi(
      version !== undefined,
      503,
      "REFERENCE_APPLICATION_NOT_PUBLISHED",
      "Reference application is not published",
    );
    const expectedRows = definition.tables.reduce(
      (sum, item) => sum + item.rowCount,
      0,
    );
    const testRowCount = this.#rowCount(projectId, "test", schema.tables);
    const productionRowCount = this.#rowCount(
      projectId,
      "production",
      schema.tables,
    );
    assertApi(
      pages.length === 4 &&
        elements.length >= 19 &&
        schema.tables.length === definition.tables.length &&
        graph.edges.length >= 13 &&
        testRowCount === expectedRows &&
        productionRowCount === expectedRows,
      503,
      "REFERENCE_APPLICATION_INCOMPLETE",
      "Reference application did not pass its operational inventory",
      {
        kind: definition.kind,
        pages: pages.length,
        elements: elements.length,
        tables: schema.tables.length,
        bindings: graph.edges.length,
        testRowCount,
        productionRowCount,
        expectedRows,
      },
    );
    return {
      kind: definition.kind,
      projectId,
      name: project.name,
      slug: project.slug,
      pageCount: pages.length,
      elementCount: elements.length,
      tableCount: schema.tables.length,
      testRowCount,
      productionRowCount,
      bindingCount: graph.edges.length,
      publishedVersionId: version.id,
      status: "READY",
    };
  }
}
