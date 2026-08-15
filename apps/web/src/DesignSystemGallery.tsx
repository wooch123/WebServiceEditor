import {
  ActivityIcon,
  ArrowRightIcon,
  BarChart3Icon,
  BellIcon,
  BlocksIcon,
  CalendarDaysIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  CircleHelpIcon,
  CloudUploadIcon,
  Code2Icon,
  DatabaseIcon,
  DownloadIcon,
  FileTextIcon,
  HeartIcon,
  InboxIcon,
  LayoutDashboardIcon,
  MoreHorizontalIcon,
  PanelLeftIcon,
  PlusIcon,
  SearchIcon,
  Settings2Icon,
  ShieldCheckIcon,
  SparklesIcon,
  Trash2Icon,
} from "lucide-react";
import { useState } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { toast } from "sonner";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { AspectRatio } from "@/components/ui/aspect-ratio";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment";
import {
  Avatar,
  AvatarBadge,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
} from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  Bubble,
  BubbleContent,
  BubbleGroup,
  BubbleReactions,
} from "@/components/ui/bubble";
import {
  ButtonGroup,
  ButtonGroupSeparator,
  ButtonGroupText,
} from "@/components/ui/button-group";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
} from "@/components/ui/combobox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { DirectionProvider } from "@/components/ui/direction";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { Input } from "@/components/ui/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Label } from "@/components/ui/label";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import {
  Menubar,
  MenubarContent,
  MenubarGroup,
  MenubarItem,
  MenubarLabel,
  MenubarMenu,
  MenubarSeparator,
  MenubarShortcut,
  MenubarTrigger,
} from "@/components/ui/menubar";
import {
  Message,
  MessageAvatar,
  MessageContent,
  MessageFooter,
  MessageGroup,
  MessageHeader,
} from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import {
  NativeSelect,
  NativeSelectOptGroup,
  NativeSelectOption,
} from "@/components/ui/native-select";
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuIndicator,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "@/components/ui/navigation-menu";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoiceDescription,
  QuestionnaireChoices,
  QuestionnaireDescription,
  QuestionnaireItem,
  QuestionnaireProgress,
  QuestionnaireSubmit,
  QuestionnaireTitle,
} from "@/components/ui/questionnaire";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Toaster } from "@/components/ui/sonner";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Toggle } from "@/components/ui/toggle";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export const COMPONENT_FAMILIES = [
  "accordion",
  "alert-dialog",
  "alert",
  "aspect-ratio",
  "attachment",
  "avatar",
  "badge",
  "breadcrumb",
  "bubble",
  "button-group",
  "button",
  "calendar",
  "card",
  "carousel",
  "chart",
  "checkbox",
  "collapsible",
  "combobox",
  "command",
  "context-menu",
  "dialog",
  "direction",
  "drawer",
  "dropdown-menu",
  "empty",
  "field",
  "hover-card",
  "input-group",
  "input-otp",
  "input",
  "item",
  "kbd",
  "label",
  "marker",
  "menubar",
  "message-scroller",
  "message",
  "native-select",
  "navigation-menu",
  "pagination",
  "popover",
  "progress",
  "questionnaire",
  "radio-group",
  "resizable",
  "scroll-area",
  "select",
  "separator",
  "sheet",
  "sidebar",
  "skeleton",
  "slider",
  "sonner",
  "spinner",
  "switch",
  "table",
  "tabs",
  "textarea",
  "toggle-group",
  "toggle",
  "tooltip",
] as const;

type ComponentFamily = (typeof COMPONENT_FAMILIES)[number];

const chartData = [
  { month: "3월", services: 186, validations: 80 },
  { month: "4월", services: 205, validations: 118 },
  { month: "5월", services: 237, validations: 146 },
  { month: "6월", services: 214, validations: 172 },
  { month: "7월", services: 268, validations: 204 },
  { month: "8월", services: 292, validations: 238 },
];

const chartConfig = {
  services: { label: "서비스", color: "var(--chart-1)" },
  validations: { label: "검증", color: "var(--chart-3)" },
} satisfies ChartConfig;

const comboboxItems = ["대시보드", "설문 분석", "품질 관리", "빈 프로젝트"];

function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="flex max-w-3xl flex-col gap-2">
      <Badge variant="outline" className="w-fit">
        {eyebrow}
      </Badge>
      <h2 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">
        {title}
      </h2>
      <p className="text-sm leading-relaxed text-muted-foreground sm:text-base">
        {description}
      </p>
    </div>
  );
}

function Family({
  family,
  title,
  description,
  children,
  wide = false,
}: {
  family: ComponentFamily;
  title: string;
  description: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <Card
      data-component-family={family}
      className={wide ? "lg:col-span-2 xl:col-span-3" : undefined}
    >
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          <Badge variant="secondary" className="shrink-0 font-mono">
            {family}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function GalleryHeader() {
  return (
    <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex max-w-screen-2xl items-center gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <a
          href="/"
          className="flex min-w-0 items-center gap-3 rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          aria-label="WebEditor 프로젝트 홈"
        >
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
            <BlocksIcon aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">
              WebEditor
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              내부 디자인 시스템
            </span>
          </span>
        </a>
        <nav
          className="ml-auto hidden items-center gap-1 md:flex"
          aria-label="갤러리 섹션"
        >
          <Button variant="ghost" size="sm" asChild>
            <a href="#foundation">기초</a>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <a href="#forms">입력</a>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <a href="#data-display">데이터</a>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <a href="#navigation">구조</a>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <a href="#overlays">오버레이</a>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <a href="#messaging">메시징</a>
          </Button>
        </nav>
        <Badge variant="outline" className="ml-auto md:ml-0">
          {COMPONENT_FAMILIES.length} families
        </Badge>
      </div>
    </header>
  );
}

function FoundationSection() {
  return (
    <section id="foundation" className="scroll-mt-24">
      <SectionHeading
        eyebrow="FOUNDATION"
        title="작은 상태에서 드러나는 제품의 결"
        description="행동, 상태, 리듬과 피드백을 제품의 공통 의미 토큰으로 표현합니다. 각 샘플은 키보드 탐색과 명확한 레이블을 포함합니다."
      />
      <div className="mt-8 grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <Family
          family="button"
          title="버튼"
          description="주요 행동과 안전한 보조 행동"
        >
          <div className="flex flex-wrap gap-2">
            <Button>
              <PlusIcon data-icon="inline-start" />새 프로젝트
            </Button>
            <Button variant="secondary">초안 저장</Button>
            <Button variant="outline">미리보기</Button>
            <Button variant="ghost" size="icon" aria-label="더 보기">
              <MoreHorizontalIcon />
            </Button>
            <Button variant="destructive">
              <Trash2Icon data-icon="inline-start" />
              삭제
            </Button>
            <Button disabled>
              <Spinner data-icon="inline-start" />
              저장 중
            </Button>
          </div>
        </Family>

        <Family
          family="button-group"
          title="버튼 그룹"
          description="밀접한 명령과 단위 정보"
        >
          <ButtonGroup>
            <Button variant="outline">초안</Button>
            <ButtonGroupSeparator />
            <Button variant="outline">게시</Button>
            <ButtonGroupText>
              <CloudUploadIcon />
              v1.8
            </ButtonGroupText>
          </ButtonGroup>
        </Family>

        <Family
          family="badge"
          title="배지"
          description="상태와 범주를 압축해 표시"
        >
          <div className="flex flex-wrap gap-2">
            <Badge>운영 중</Badge>
            <Badge variant="secondary">초안 r18</Badge>
            <Badge variant="outline">검증 대기</Badge>
            <Badge variant="destructive">연결 오류</Badge>
          </div>
        </Family>

        <Family
          family="avatar"
          title="아바타"
          description="소유자와 협업자 식별"
        >
          <AvatarGroup>
            <Avatar>
              <AvatarFallback>CH</AvatarFallback>
              <AvatarBadge />
            </Avatar>
            <Avatar>
              <AvatarFallback>DS</AvatarFallback>
            </Avatar>
            <Avatar>
              <AvatarFallback>QA</AvatarFallback>
            </Avatar>
            <AvatarGroupCount>+4</AvatarGroupCount>
          </AvatarGroup>
        </Family>

        <Family
          family="kbd"
          title="키보드 힌트"
          description="반복 작업의 단축키"
        >
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            명령 팔레트
            <KbdGroup>
              <Kbd>⌘</Kbd>
              <Kbd>K</Kbd>
            </KbdGroup>
          </div>
        </Family>

        <Family
          family="separator"
          title="구분선"
          description="내용 계층의 조용한 경계"
        >
          <div className="flex flex-col gap-3 text-sm">
            <span>페이지 정의</span>
            <Separator />
            <span className="text-muted-foreground">실행 데이터베이스</span>
          </div>
        </Family>

        <Family
          family="aspect-ratio"
          title="종횡비"
          description="일관된 미디어와 미리보기 영역"
        >
          <AspectRatio
            ratio={16 / 9}
            className="overflow-hidden rounded-lg bg-muted"
          >
            <div className="grid size-full place-items-center text-muted-foreground">
              <BarChart3Icon aria-hidden="true" />
              <span className="sr-only">16대 9 차트 미리보기</span>
            </div>
          </AspectRatio>
        </Family>

        <Family
          family="direction"
          title="방향"
          description="LTR과 RTL 문맥 지원"
        >
          <DirectionProvider dir="rtl" direction="rtl">
            <div
              dir="rtl"
              className="flex items-center justify-between rounded-lg border p-3 text-sm"
            >
              <span>اتجاه الواجهة</span>
              <ArrowRightIcon aria-hidden="true" />
            </div>
          </DirectionProvider>
        </Family>

        <Family
          family="tooltip"
          title="툴팁"
          description="아이콘 행동의 보조 설명"
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="icon" aria-label="도움말 열기">
                <CircleHelpIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>선택한 요소의 속성을 설명합니다.</TooltipContent>
          </Tooltip>
        </Family>

        <Family
          family="spinner"
          title="스피너"
          description="짧은 비동기 작업 상태"
        >
          <div className="flex items-center gap-3 text-sm" role="status">
            <Spinner />
            실제 데이터 검증 중
          </div>
        </Family>

        <Family
          family="skeleton"
          title="스켈레톤"
          description="레이아웃을 보존하는 로딩 상태"
        >
          <div className="flex items-center gap-3">
            <Skeleton className="size-10 rounded-full" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="h-3 w-full" />
            </div>
          </div>
        </Family>

        <Family
          family="progress"
          title="진행률"
          description="정량적 단계 완료 상태"
        >
          <div className="flex flex-col gap-2">
            <div className="flex justify-between text-sm">
              <span>게시 준비</span>
              <span className="text-muted-foreground">72%</span>
            </div>
            <Progress value={72} aria-label="게시 준비 72퍼센트" />
          </div>
        </Family>
      </div>
    </section>
  );
}

function FormsSection() {
  const [date, setDate] = useState<Date | undefined>(new Date(2026, 7, 15));
  const [otpValue, setOtpValue] = useState("381204");

  return (
    <section id="forms" className="scroll-mt-24">
      <SectionHeading
        eyebrow="INPUTS"
        title="비개발자도 실수 없이 입력하는 흐름"
        description="레이블, 설명, 선택 상태와 오류 맥락을 함께 제시합니다. 표시 이름이 아닌 안정적인 값으로 선택을 보존하는 UI 패턴입니다."
      />
      <div className="mt-8 grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <Family
          family="field"
          title="필드"
          description="폼 레이아웃과 설명의 기준"
        >
          <FieldSet>
            <FieldLegend variant="label">프로젝트 설정</FieldLegend>
            <FieldDescription>
              초안에 저장될 기본 정보를 입력합니다.
            </FieldDescription>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="gallery-project-name">
                  프로젝트 이름
                </FieldLabel>
                <Input id="gallery-project-name" defaultValue="지역 건강지표" />
              </Field>
            </FieldGroup>
          </FieldSet>
        </Family>

        <Family
          family="input"
          title="입력"
          description="단일 행 텍스트와 검증 상태"
        >
          <Field data-invalid>
            <FieldLabel htmlFor="gallery-slug">공개 경로</FieldLabel>
            <Input
              id="gallery-slug"
              defaultValue="regional health"
              aria-invalid
            />
            <FieldDescription>
              공백 없이 영문 소문자를 사용하세요.
            </FieldDescription>
          </Field>
        </Family>

        <Family
          family="textarea"
          title="텍스트 영역"
          description="긴 설명과 메모"
        >
          <Field>
            <FieldLabel htmlFor="gallery-description">서비스 설명</FieldLabel>
            <Textarea
              id="gallery-description"
              defaultValue="시군구별 의료 이용 변화를 한눈에 추적합니다."
            />
          </Field>
        </Family>

        <Family
          family="input-group"
          title="입력 그룹"
          description="검색과 인라인 행동의 결합"
        >
          <Field>
            <FieldLabel htmlFor="gallery-search">프로젝트 검색</FieldLabel>
            <InputGroup>
              <InputGroupAddon>
                <SearchIcon />
              </InputGroupAddon>
              <InputGroupInput
                id="gallery-search"
                placeholder="이름 또는 설명"
              />
              <InputGroupAddon align="inline-end">
                <InputGroupText>
                  <Kbd>⌘K</Kbd>
                </InputGroupText>
                <InputGroupButton size="icon-xs" aria-label="검색 실행">
                  <ArrowRightIcon />
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
          </Field>
        </Family>

        <Family
          family="label"
          title="레이블"
          description="컨트롤과 명시적 연결"
        >
          <div className="flex items-center gap-3">
            <Switch id="gallery-label-switch" />
            <Label htmlFor="gallery-label-switch">게시 후 알림 받기</Label>
          </div>
        </Family>

        <Family
          family="checkbox"
          title="체크박스"
          description="독립적인 선택 항목"
        >
          <Field orientation="horizontal">
            <Checkbox id="gallery-backup" defaultChecked />
            <FieldLabel htmlFor="gallery-backup">게시 전 자동 백업</FieldLabel>
          </Field>
        </Family>

        <Family
          family="radio-group"
          title="라디오 그룹"
          description="한 가지 실행 환경 선택"
        >
          <FieldSet>
            <FieldLegend variant="label">데이터 환경</FieldLegend>
            <RadioGroup defaultValue="test">
              <Field orientation="horizontal">
                <RadioGroupItem id="gallery-test-db" value="test" />
                <FieldLabel htmlFor="gallery-test-db">테스트 DB</FieldLabel>
              </Field>
              <Field orientation="horizontal">
                <RadioGroupItem id="gallery-production-db" value="production" />
                <FieldLabel htmlFor="gallery-production-db">운영 DB</FieldLabel>
              </Field>
            </RadioGroup>
          </FieldSet>
        </Family>

        <Family family="switch" title="스위치" description="즉시 적용되는 설정">
          <Field orientation="horizontal">
            <div className="flex flex-1 flex-col gap-1">
              <FieldLabel htmlFor="gallery-runtime">런타임 공개</FieldLabel>
              <FieldDescription>
                검증을 통과한 버전을 제공합니다.
              </FieldDescription>
            </div>
            <Switch id="gallery-runtime" defaultChecked />
          </Field>
        </Family>

        <Family
          family="slider"
          title="슬라이더"
          description="연속 범위와 현재 값"
        >
          <Field>
            <div className="flex justify-between gap-3">
              <FieldLabel htmlFor="gallery-confidence">신뢰수준</FieldLabel>
              <output className="text-sm text-muted-foreground">95%</output>
            </div>
            <Slider
              id="gallery-confidence"
              defaultValue={[95]}
              max={100}
              step={1}
            />
          </Field>
        </Family>

        <Family
          family="select"
          title="선택 목록"
          description="정해진 옵션의 단일 선택"
        >
          <Field>
            <FieldLabel htmlFor="gallery-chart-select">차트 유형</FieldLabel>
            <Select defaultValue="line">
              <SelectTrigger id="gallery-chart-select">
                <SelectValue placeholder="차트 선택" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>통계 차트</SelectLabel>
                  <SelectItem value="line">선 차트</SelectItem>
                  <SelectItem value="bar">막대 차트</SelectItem>
                  <SelectItem value="scatter">산점도</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        </Family>

        <Family
          family="native-select"
          title="네이티브 선택"
          description="브라우저 기본 선택 경험"
        >
          <Field>
            <FieldLabel htmlFor="gallery-density">표 밀도</FieldLabel>
            <NativeSelect id="gallery-density" defaultValue="comfortable">
              <NativeSelectOptGroup label="표시 밀도">
                <NativeSelectOption value="compact">
                  촘촘하게
                </NativeSelectOption>
                <NativeSelectOption value="comfortable">
                  편안하게
                </NativeSelectOption>
              </NativeSelectOptGroup>
            </NativeSelect>
          </Field>
        </Family>

        <Family
          family="combobox"
          title="콤보박스"
          description="검색 가능한 프로젝트 유형"
        >
          <Combobox items={comboboxItems} defaultValue="대시보드">
            <ComboboxInput placeholder="프로젝트 유형 검색" showClear />
            <ComboboxContent>
              <ComboboxList>
                <ComboboxEmpty>검색 결과가 없습니다.</ComboboxEmpty>
                <ComboboxGroup>
                  <ComboboxLabel>레이아웃 프리셋</ComboboxLabel>
                  {comboboxItems.map((item) => (
                    <ComboboxItem key={item} value={item}>
                      {item}
                    </ComboboxItem>
                  ))}
                </ComboboxGroup>
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
        </Family>

        <Family
          family="input-otp"
          title="OTP 입력"
          description="분리된 일회용 코드 입력"
        >
          <Field>
            <FieldLabel htmlFor="gallery-otp">게시 확인 코드</FieldLabel>
            <InputOTP
              id="gallery-otp"
              maxLength={6}
              value={otpValue}
              onChange={setOtpValue}
            >
              <InputOTPGroup>
                <InputOTPSlot index={0} />
                <InputOTPSlot index={1} />
                <InputOTPSlot index={2} />
              </InputOTPGroup>
              <InputOTPSeparator />
              <InputOTPGroup>
                <InputOTPSlot index={3} />
                <InputOTPSlot index={4} />
                <InputOTPSlot index={5} />
              </InputOTPGroup>
            </InputOTP>
          </Field>
        </Family>

        <Family
          family="toggle"
          title="토글"
          description="한 가지 표시 모드 전환"
        >
          <Toggle aria-label="격자 표시" defaultPressed>
            <LayoutDashboardIcon />
            격자
          </Toggle>
        </Family>

        <Family
          family="toggle-group"
          title="토글 그룹"
          description="2–5개 보기 방식 선택"
        >
          <ToggleGroup type="single" defaultValue="desktop" variant="outline">
            <ToggleGroupItem value="desktop">Desktop</ToggleGroupItem>
            <ToggleGroupItem value="tablet">Tablet</ToggleGroupItem>
            <ToggleGroupItem value="mobile">Mobile</ToggleGroupItem>
          </ToggleGroup>
        </Family>

        <Family
          family="questionnaire"
          title="질문지"
          description="단계형 구조화 입력"
          wide
        >
          <Questionnaire
            items={[
              {
                name: "purpose",
                required: true,
                choices: [
                  { value: "monitoring" },
                  { value: "reporting" },
                  { value: "exploration" },
                ],
              },
            ]}
            shortcuts="numbers"
            onSubmit={(event) => event.preventDefault()}
          >
            <QuestionnaireProgress>질문 1 / 1</QuestionnaireProgress>
            <QuestionnaireItem name="purpose" required>
              <QuestionnaireTitle>
                이 서비스의 가장 중요한 목적은 무엇인가요?
              </QuestionnaireTitle>
              <QuestionnaireDescription>
                이후 추천되는 레이아웃과 검증 흐름에 반영됩니다.
              </QuestionnaireDescription>
              <QuestionnaireChoices>
                <QuestionnaireChoice value="monitoring" defaultChecked>
                  상시 모니터링
                  <QuestionnaireChoiceDescription>
                    지표 변화와 이상 신호를 지속해서 봅니다.
                  </QuestionnaireChoiceDescription>
                </QuestionnaireChoice>
                <QuestionnaireChoice value="reporting">
                  정기 보고
                  <QuestionnaireChoiceDescription>
                    정해진 주기로 결과를 공유합니다.
                  </QuestionnaireChoiceDescription>
                </QuestionnaireChoice>
                <QuestionnaireChoice value="exploration">
                  탐색 분석
                  <QuestionnaireChoiceDescription>
                    여러 변수의 관계를 자유롭게 살펴봅니다.
                  </QuestionnaireChoiceDescription>
                </QuestionnaireChoice>
              </QuestionnaireChoices>
            </QuestionnaireItem>
            <QuestionnaireActions>
              <QuestionnaireSubmit>선택 완료</QuestionnaireSubmit>
            </QuestionnaireActions>
          </Questionnaire>
        </Family>

        <Family
          family="calendar"
          title="달력"
          description="날짜 범위의 명확한 탐색"
          wide
        >
          <div className="flex justify-center">
            <Calendar
              mode="single"
              selected={date}
              onSelect={setDate}
              defaultMonth={new Date(2026, 7)}
            />
          </div>
        </Family>
      </div>
    </section>
  );
}

function DataDisplaySection() {
  return (
    <section id="data-display" className="scroll-mt-24">
      <SectionHeading
        eyebrow="DATA DISPLAY"
        title="숫자와 구조를 읽기 쉽게"
        description="통계 서비스의 핵심 정보가 표, 차트, 항목과 빈 상태에서 같은 위계로 읽히도록 구성합니다."
      />
      <div className="mt-8 grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <Family
          family="card"
          title="카드"
          description="설명과 행동을 갖춘 완전한 구성"
        >
          <Card>
            <CardHeader>
              <CardTitle>지역 건강지표</CardTitle>
              <CardDescription>최근 게시된 운영 버전</CardDescription>
              <CardAction>
                <Badge>v1.7</Badge>
              </CardAction>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold tabular-nums">98.6%</p>
              <p className="text-sm text-muted-foreground">데이터 완성도</p>
            </CardContent>
            <CardFooter>
              <Button variant="outline" size="sm">
                상세 보기
              </Button>
            </CardFooter>
          </Card>
        </Family>

        <Family
          family="item"
          title="항목"
          description="미디어·설명·행동의 반복 행"
        >
          <ItemGroup>
            <Item variant="outline">
              <ItemMedia variant="icon">
                <DatabaseIcon />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>regional_health</ItemTitle>
                <ItemDescription>SQLite · 12개 필드 · 연결됨</ItemDescription>
              </ItemContent>
              <ItemActions>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="데이터베이스 설정"
                >
                  <Settings2Icon />
                </Button>
              </ItemActions>
            </Item>
          </ItemGroup>
        </Family>

        <Family
          family="empty"
          title="빈 상태"
          description="막힘 없이 다음 행동 제시"
        >
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <InboxIcon />
              </EmptyMedia>
              <EmptyTitle>아직 바인딩이 없습니다</EmptyTitle>
              <EmptyDescription>
                데이터 필드를 요소의 입력 포트에 연결하세요.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button size="sm">
                <PlusIcon data-icon="inline-start" />
                바인딩 추가
              </Button>
            </EmptyContent>
          </Empty>
        </Family>

        <Family
          family="table"
          title="표"
          description="정렬 가능한 구조화 데이터"
          wide
        >
          <Table>
            <TableCaption>최근 3개 지역의 월별 표본입니다.</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>지역</TableHead>
                <TableHead>표본 수</TableHead>
                <TableHead>완성도</TableHead>
                <TableHead className="text-right">상태</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[
                ["서울", "2,418", "99.2%", "검증됨"],
                ["부산", "1,706", "98.4%", "검증됨"],
                ["대전", "932", "96.8%", "확인 필요"],
              ].map(([region, samples, completeness, status]) => (
                <TableRow key={region}>
                  <TableCell className="font-medium">{region}</TableCell>
                  <TableCell>{samples}</TableCell>
                  <TableCell>{completeness}</TableCell>
                  <TableCell className="text-right">
                    <Badge
                      variant={status === "검증됨" ? "secondary" : "outline"}
                    >
                      {status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Family>

        <Family
          family="chart"
          title="차트"
          description="Semantic chart token 기반 추이"
          wide
        >
          <ChartContainer config={chartConfig} className="max-h-72 w-full">
            <AreaChart
              accessibilityLayer
              data={chartData}
              margin={{ left: 4, right: 4 }}
            >
              <CartesianGrid vertical={false} />
              <XAxis dataKey="month" tickLine={false} axisLine={false} />
              <YAxis tickLine={false} axisLine={false} width={32} />
              <ChartTooltip
                content={<ChartTooltipContent indicator="line" />}
              />
              <Area
                dataKey="services"
                type="monotone"
                fill="var(--color-services)"
                fillOpacity={0.2}
                stroke="var(--color-services)"
              />
              <Area
                dataKey="validations"
                type="monotone"
                fill="var(--color-validations)"
                fillOpacity={0.12}
                stroke="var(--color-validations)"
              />
            </AreaChart>
          </ChartContainer>
        </Family>
      </div>
    </section>
  );
}

function NavigationSection() {
  const [collapsibleOpen, setCollapsibleOpen] = useState(true);

  return (
    <section id="navigation" className="scroll-mt-24">
      <SectionHeading
        eyebrow="LAYOUT & NAVIGATION"
        title="복잡한 작업 공간을 길 잃지 않게"
        description="계층, 전환, 스크롤과 패널 구성을 실제 편집기 맥락에 가까운 크기로 확인합니다."
      />
      <div className="mt-8 grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <Family
          family="accordion"
          title="아코디언"
          description="필요한 속성만 펼쳐 보기"
        >
          <Accordion type="single" collapsible defaultValue="appearance">
            <AccordionItem value="appearance">
              <AccordionTrigger>모양</AccordionTrigger>
              <AccordionContent>
                간격, 정렬, 테두리와 배경을 설정합니다.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="data">
              <AccordionTrigger>데이터</AccordionTrigger>
              <AccordionContent>
                입력 필드와 집계 방식을 연결합니다.
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </Family>

        <Family
          family="collapsible"
          title="접기"
          description="보조 정보의 선택적 노출"
        >
          <Collapsible open={collapsibleOpen} onOpenChange={setCollapsibleOpen}>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium">고급 배치 옵션</span>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm">
                  {collapsibleOpen ? "접기" : "펼치기"}
                  <ChevronDownIcon data-icon="inline-end" />
                </Button>
              </CollapsibleTrigger>
            </div>
            <CollapsibleContent>
              <p className="mt-3 rounded-lg bg-muted p-3 text-sm text-muted-foreground">
                Grid span 6 · 최소 높이 280px · 자동 정렬 사용
              </p>
            </CollapsibleContent>
          </Collapsible>
        </Family>

        <Family family="tabs" title="탭" description="동일 맥락의 보기 전환">
          <Tabs defaultValue="draft">
            <TabsList>
              <TabsTrigger value="draft">초안</TabsTrigger>
              <TabsTrigger value="published">게시 버전</TabsTrigger>
            </TabsList>
            <TabsContent
              value="draft"
              className="text-sm text-muted-foreground"
            >
              r18 · 마지막 저장 오늘 14:32
            </TabsContent>
            <TabsContent
              value="published"
              className="text-sm text-muted-foreground"
            >
              v1.7 · 운영 중
            </TabsContent>
          </Tabs>
        </Family>

        <Family
          family="breadcrumb"
          title="브레드크럼"
          description="현재 위치와 상위 맥락"
        >
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink href="#foundation">프로젝트</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbLink href="#navigation">
                  지역 건강지표
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>페이지 디자인</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </Family>

        <Family
          family="navigation-menu"
          title="내비게이션 메뉴"
          description="상위 작업 영역 이동"
        >
          <NavigationMenu viewport={false}>
            <NavigationMenuList>
              <NavigationMenuItem>
                <NavigationMenuLink href="#data-display">
                  대시보드
                </NavigationMenuLink>
              </NavigationMenuItem>
              <NavigationMenuItem>
                <NavigationMenuTrigger>설계</NavigationMenuTrigger>
                <NavigationMenuContent>
                  <NavigationMenuLink href="#forms">
                    입력 요소
                  </NavigationMenuLink>
                  <NavigationMenuLink href="#messaging">
                    런타임 메시지
                  </NavigationMenuLink>
                </NavigationMenuContent>
              </NavigationMenuItem>
              <NavigationMenuIndicator />
            </NavigationMenuList>
          </NavigationMenu>
        </Family>

        <Family
          family="pagination"
          title="페이지네이션"
          description="긴 데이터 결과 탐색"
        >
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious href="#navigation" text="이전" />
              </PaginationItem>
              <PaginationItem>
                <PaginationLink href="#navigation" isActive>
                  1
                </PaginationLink>
              </PaginationItem>
              <PaginationItem>
                <PaginationLink href="#navigation">2</PaginationLink>
              </PaginationItem>
              <PaginationItem>
                <PaginationEllipsis />
              </PaginationItem>
              <PaginationItem>
                <PaginationNext href="#navigation" text="다음" />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </Family>

        <Family
          family="carousel"
          title="캐러셀"
          description="레이아웃 프리셋 탐색"
          wide
        >
          <Carousel opts={{ align: "start" }} className="mx-10">
            <CarouselContent>
              {["통계 대시보드", "설문 리포트", "품질 관리", "빈 캔버스"].map(
                (preset, index) => (
                  <CarouselItem
                    key={preset}
                    className="sm:basis-1/2 lg:basis-1/3"
                  >
                    <Card>
                      <CardHeader>
                        <Badge variant="outline" className="w-fit">
                          Preset {index + 1}
                        </Badge>
                        <CardTitle>{preset}</CardTitle>
                        <CardDescription>
                          실제 요소와 반응형 Grid 포함
                        </CardDescription>
                      </CardHeader>
                    </Card>
                  </CarouselItem>
                ),
              )}
            </CarouselContent>
            <CarouselPrevious />
            <CarouselNext />
          </Carousel>
        </Family>

        <Family
          family="scroll-area"
          title="스크롤 영역"
          description="긴 이벤트 목록의 독립 스크롤"
        >
          <ScrollArea className="h-44 rounded-lg border">
            <div className="flex flex-col gap-3 p-4">
              {Array.from({ length: 8 }, (_, index) => (
                <div key={index} className="flex items-center gap-3 text-sm">
                  <CheckCircle2Icon aria-hidden="true" />
                  <span>검증 단계 {index + 1} 통과</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    14:{index}0
                  </span>
                </div>
              ))}
            </div>
          </ScrollArea>
        </Family>

        <Family
          family="resizable"
          title="크기 조절 패널"
          description="편집기와 Inspector 분할"
          wide
        >
          <ResizablePanelGroup
            orientation="horizontal"
            className="h-40 overflow-hidden rounded-lg border"
          >
            <ResizablePanel defaultSize={35} minSize={20}>
              <div className="flex size-full items-center justify-center gap-2 bg-muted text-sm">
                <PanelLeftIcon aria-hidden="true" />
                페이지 목록
              </div>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={65} minSize={30}>
              <div className="flex size-full items-center justify-center gap-2 text-sm">
                <LayoutDashboardIcon aria-hidden="true" />
                캔버스
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </Family>

        <Family
          family="sidebar"
          title="사이드바"
          description="축소 가능한 제품 내비게이션"
          wide
        >
          <SidebarProvider className="h-64 min-h-0 overflow-hidden rounded-lg border">
            <Sidebar collapsible="none" className="w-60 border-r">
              <SidebarHeader>
                <SidebarInput
                  aria-label="페이지 검색"
                  placeholder="페이지 검색"
                />
              </SidebarHeader>
              <SidebarSeparator />
              <SidebarContent>
                <SidebarGroup>
                  <SidebarGroupLabel>프로젝트 페이지</SidebarGroupLabel>
                  <SidebarGroupContent>
                    <SidebarMenu>
                      <SidebarMenuItem>
                        <SidebarMenuButton isActive>
                          <LayoutDashboardIcon />
                          <span>운영 개요</span>
                          <SidebarMenuBadge>6</SidebarMenuBadge>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                      <SidebarMenuItem>
                        <SidebarMenuButton>
                          <BarChart3Icon />
                          <span>지역별 비교</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                      <SidebarMenuItem>
                        <SidebarMenuButton>
                          <DatabaseIcon />
                          <span>원자료 조회</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    </SidebarMenu>
                  </SidebarGroupContent>
                </SidebarGroup>
              </SidebarContent>
              <SidebarFooter>
                <Button variant="outline" size="sm">
                  <PlusIcon data-icon="inline-start" />
                  페이지 추가
                </Button>
              </SidebarFooter>
            </Sidebar>
            <div className="flex flex-1 items-center justify-center bg-background text-sm text-muted-foreground">
              선택한 페이지 캔버스
            </div>
          </SidebarProvider>
        </Family>
      </div>
    </section>
  );
}

function OverlaySection() {
  return (
    <section id="overlays" className="scroll-mt-24">
      <SectionHeading
        eyebrow="OVERLAYS & FEEDBACK"
        title="행동 전에 맥락을, 행동 뒤에는 결과를"
        description="각 오버레이는 의미에 맞는 제목과 설명을 포함하며, 파괴적 행동은 별도 확인 흐름으로 분리합니다."
      />
      <div className="mt-8 grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <Family
          family="alert"
          title="알림"
          description="페이지 안의 중요한 상태"
        >
          <Alert>
            <ShieldCheckIcon aria-hidden="true" />
            <AlertTitle>샘플 데이터 검증 완료</AlertTitle>
            <AlertDescription>
              읽기 바인딩 12개가 모두 예상 결과와 일치합니다.
            </AlertDescription>
            <AlertAction>
              <Button variant="outline" size="sm">
                결과 보기
              </Button>
            </AlertAction>
          </Alert>
        </Family>

        <Family
          family="alert-dialog"
          title="경고 대화상자"
          description="파괴적 행동의 명시적 확인"
        >
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive">
                <Trash2Icon data-icon="inline-start" />
                프로젝트 삭제
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogMedia>
                  <Trash2Icon />
                </AlertDialogMedia>
                <AlertDialogTitle>휴지통으로 이동할까요?</AlertDialogTitle>
                <AlertDialogDescription>
                  프로젝트 정의는 보존되며 휴지통에서 다시 복원할 수 있습니다.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>취소</AlertDialogCancel>
                <AlertDialogAction variant="destructive">
                  이동
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </Family>

        <Family
          family="dialog"
          title="대화상자"
          description="집중이 필요한 편집 작업"
        >
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline">페이지 이름 변경</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>페이지 이름 변경</DialogTitle>
                <DialogDescription>
                  내비게이션과 게시된 런타임에 함께 표시됩니다.
                </DialogDescription>
              </DialogHeader>
              <Field>
                <FieldLabel htmlFor="gallery-dialog-name">
                  페이지 이름
                </FieldLabel>
                <Input id="gallery-dialog-name" defaultValue="지역별 비교" />
              </Field>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline">취소</Button>
                </DialogClose>
                <DialogClose asChild>
                  <Button>저장</Button>
                </DialogClose>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </Family>

        <Family
          family="sheet"
          title="시트"
          description="옆에서 열리는 속성 Inspector"
        >
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline">
                <Settings2Icon data-icon="inline-start" />
                Inspector 열기
              </Button>
            </SheetTrigger>
            <SheetContent>
              <SheetHeader>
                <SheetTitle>차트 속성</SheetTitle>
                <SheetDescription>
                  선택한 차트의 데이터와 표현을 설정합니다.
                </SheetDescription>
              </SheetHeader>
              <FieldGroup className="px-4">
                <Field>
                  <FieldLabel htmlFor="gallery-sheet-title">
                    차트 제목
                  </FieldLabel>
                  <Input
                    id="gallery-sheet-title"
                    defaultValue="월별 재원일수"
                  />
                </Field>
              </FieldGroup>
              <SheetFooter>
                <SheetClose asChild>
                  <Button>적용</Button>
                </SheetClose>
              </SheetFooter>
            </SheetContent>
          </Sheet>
        </Family>

        <Family
          family="drawer"
          title="드로어"
          description="모바일 우선 하단 작업 패널"
        >
          <Drawer>
            <DrawerTrigger asChild>
              <Button variant="outline">레이아웃 선택</Button>
            </DrawerTrigger>
            <DrawerContent>
              <DrawerHeader>
                <DrawerTitle>레이아웃 프리셋 선택</DrawerTitle>
                <DrawerDescription>
                  콘텐츠에 맞는 시작 구조를 선택하세요.
                </DrawerDescription>
              </DrawerHeader>
              <div className="grid gap-3 px-4 sm:grid-cols-3">
                {comboboxItems.slice(0, 3).map((item) => (
                  <Button key={item} variant="outline">
                    {item}
                  </Button>
                ))}
              </div>
              <DrawerFooter>
                <DrawerClose asChild>
                  <Button variant="outline">닫기</Button>
                </DrawerClose>
              </DrawerFooter>
            </DrawerContent>
          </Drawer>
        </Family>

        <Family family="popover" title="팝오버" description="가벼운 문맥 입력">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline">
                <CalendarDaysIcon data-icon="inline-start" />
                게시 예약
              </Button>
            </PopoverTrigger>
            <PopoverContent>
              <PopoverHeader>
                <PopoverTitle>게시 예약</PopoverTitle>
                <PopoverDescription>
                  로컬 시간 기준으로 예약합니다.
                </PopoverDescription>
              </PopoverHeader>
              <Input type="datetime-local" aria-label="게시 예약 시각" />
            </PopoverContent>
          </Popover>
        </Family>

        <Family
          family="hover-card"
          title="호버 카드"
          description="대상을 떠나지 않는 빠른 정보"
        >
          <HoverCard>
            <HoverCardTrigger asChild>
              <Button variant="link">published v1.7</Button>
            </HoverCardTrigger>
            <HoverCardContent>
              <div className="flex gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted">
                  <CloudUploadIcon aria-hidden="true" />
                </span>
                <div className="flex flex-col gap-1 text-sm">
                  <strong>운영 버전 v1.7</strong>
                  <span className="text-muted-foreground">
                    8월 14일 게시 · 6개 페이지
                  </span>
                </div>
              </div>
            </HoverCardContent>
          </HoverCard>
        </Family>

        <Family
          family="dropdown-menu"
          title="드롭다운 메뉴"
          description="버튼에 연결된 보조 명령"
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                프로젝트 작업
                <ChevronDownIcon data-icon="inline-end" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuGroup>
                <DropdownMenuLabel>프로젝트</DropdownMenuLabel>
                <DropdownMenuItem>
                  <CloudUploadIcon />
                  게시<DropdownMenuShortcut>⌘P</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <DownloadIcon />
                  내보내기
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem variant="destructive">
                  <Trash2Icon />
                  휴지통으로 이동
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </Family>

        <Family
          family="context-menu"
          title="컨텍스트 메뉴"
          description="오른쪽 클릭 문맥 행동"
        >
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <Button variant="outline" className="h-24 w-full border-dashed">
                페이지를 오른쪽 클릭하세요
              </Button>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuGroup>
                <ContextMenuLabel>페이지 작업</ContextMenuLabel>
                <ContextMenuItem>
                  <FileTextIcon />
                  이름 변경<ContextMenuShortcut>F2</ContextMenuShortcut>
                </ContextMenuItem>
                <ContextMenuItem>
                  <PlusIcon />
                  복제
                </ContextMenuItem>
              </ContextMenuGroup>
              <ContextMenuSeparator />
              <ContextMenuGroup>
                <ContextMenuItem variant="destructive">
                  <Trash2Icon />
                  삭제
                </ContextMenuItem>
              </ContextMenuGroup>
            </ContextMenuContent>
          </ContextMenu>
        </Family>

        <Family
          family="menubar"
          title="메뉴바"
          description="데스크톱형 전역 명령"
        >
          <Menubar>
            <MenubarMenu>
              <MenubarTrigger>프로젝트</MenubarTrigger>
              <MenubarContent>
                <MenubarGroup>
                  <MenubarLabel>파일</MenubarLabel>
                  <MenubarItem>
                    새 프로젝트<MenubarShortcut>⌘N</MenubarShortcut>
                  </MenubarItem>
                  <MenubarItem>
                    내보내기<MenubarShortcut>⇧⌘E</MenubarShortcut>
                  </MenubarItem>
                </MenubarGroup>
                <MenubarSeparator />
                <MenubarGroup>
                  <MenubarItem>닫기</MenubarItem>
                </MenubarGroup>
              </MenubarContent>
            </MenubarMenu>
            <MenubarMenu>
              <MenubarTrigger>보기</MenubarTrigger>
              <MenubarContent>
                <MenubarGroup>
                  <MenubarItem>캔버스 맞춤</MenubarItem>
                </MenubarGroup>
              </MenubarContent>
            </MenubarMenu>
          </Menubar>
        </Family>

        <Family
          family="command"
          title="명령 팔레트"
          description="검색과 키보드 중심 탐색"
          wide
        >
          <Command className="rounded-lg border">
            <CommandInput placeholder="페이지, 요소 또는 명령 검색" />
            <CommandList>
              <CommandEmpty>검색 결과가 없습니다.</CommandEmpty>
              <CommandGroup heading="빠른 이동">
                <CommandItem>
                  <LayoutDashboardIcon />
                  페이지 디자인<CommandShortcut>⌘1</CommandShortcut>
                </CommandItem>
                <CommandItem>
                  <DatabaseIcon />
                  데이터 디자인<CommandShortcut>⌘2</CommandShortcut>
                </CommandItem>
                <CommandItem>
                  <ShieldCheckIcon />
                  테스트와 검증<CommandShortcut>⌘3</CommandShortcut>
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </Family>

        <Family
          family="sonner"
          title="토스트"
          description="행동 결과를 방해 없이 전달"
        >
          <Button
            variant="outline"
            onClick={() =>
              toast.success("초안이 저장되었습니다.", {
                description: "Draft r18 · 방금",
              })
            }
          >
            <BellIcon data-icon="inline-start" />
            토스트 확인
          </Button>
        </Family>
      </div>
    </section>
  );
}

function MessagingSection() {
  return (
    <section id="messaging" className="scroll-mt-24">
      <SectionHeading
        eyebrow="MESSAGING"
        title="진행 상황을 사람의 언어로"
        description="메시지, 파일, 반응과 시스템 마커를 전용 프리미티브로 구성해 런타임 대화 흐름을 확인합니다."
      />
      <div className="mt-8 grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <Family
          family="attachment"
          title="첨부 파일"
          description="업로드와 오류 상태를 한 표면에서"
        >
          <AttachmentGroup>
            <Attachment state="done">
              <AttachmentMedia variant="icon">
                <FileTextIcon />
              </AttachmentMedia>
              <AttachmentContent>
                <AttachmentTitle>validation-report.pdf</AttachmentTitle>
                <AttachmentDescription>PDF · 2.4 MB</AttachmentDescription>
              </AttachmentContent>
              <AttachmentActions>
                <AttachmentAction aria-label="검증 보고서 다운로드">
                  <DownloadIcon />
                </AttachmentAction>
              </AttachmentActions>
            </Attachment>
            <Attachment state="uploading">
              <AttachmentMedia variant="icon">
                <Spinner />
              </AttachmentMedia>
              <AttachmentContent>
                <AttachmentTitle>sample-data.csv</AttachmentTitle>
                <AttachmentDescription>업로드 중 · 68%</AttachmentDescription>
              </AttachmentContent>
            </Attachment>
          </AttachmentGroup>
        </Family>

        <Family
          family="marker"
          title="마커"
          description="날짜와 시스템 이벤트 구분"
        >
          <div className="flex flex-col gap-4">
            <Marker variant="separator">
              <MarkerContent>오늘</MarkerContent>
            </Marker>
            <Marker>
              <MarkerIcon>
                <CheckCircle2Icon />
              </MarkerIcon>
              <MarkerContent>검증 실행이 완료되었습니다.</MarkerContent>
            </Marker>
          </div>
        </Family>

        <Family
          family="bubble"
          title="말풍선"
          description="정렬과 반응을 가진 메시지 표면"
        >
          <BubbleGroup>
            <Bubble variant="secondary">
              <BubbleContent>월별 재원일수 차트를 추가해 주세요.</BubbleContent>
            </Bubble>
            <Bubble variant="default" align="end">
              <BubbleContent>
                차트를 배치하고 sample_data에 연결했습니다.
              </BubbleContent>
              <BubbleReactions side="bottom" align="end">
                <HeartIcon aria-hidden="true" /> 2
              </BubbleReactions>
            </Bubble>
          </BubbleGroup>
        </Family>

        <Family
          family="message"
          title="메시지"
          description="발신자와 내용·시간의 완전한 행"
          wide
        >
          <MessageGroup>
            <Message align="start">
              <MessageAvatar>
                <Avatar>
                  <AvatarFallback>WE</AvatarFallback>
                </Avatar>
              </MessageAvatar>
              <MessageContent>
                <MessageHeader>WebEditor Assistant</MessageHeader>
                <Bubble variant="secondary">
                  <BubbleContent>
                    표본 수가 적은 대전 지역을 확인해 보세요.
                  </BubbleContent>
                </Bubble>
                <MessageFooter>14:32 · 검증 결과 기반</MessageFooter>
              </MessageContent>
            </Message>
          </MessageGroup>
        </Family>

        <Family
          family="message-scroller"
          title="메시지 스크롤러"
          description="자동 추적과 최신 메시지 이동"
          wide
        >
          <div className="h-72 overflow-hidden rounded-lg border p-4">
            <MessageScrollerProvider autoScroll>
              <MessageScroller>
                <MessageScrollerViewport aria-label="디자인 시스템 대화 예시">
                  <MessageScrollerContent>
                    {(
                      [
                        [
                          "msg-1",
                          "사용자",
                          "지역별 비교 페이지를 만들어 주세요.",
                        ],
                        [
                          "msg-2",
                          "WebEditor",
                          "대시보드 프리셋을 적용했습니다.",
                        ],
                        [
                          "msg-3",
                          "WebEditor",
                          "실제 표본 데이터 5,056건을 검증했습니다.",
                        ],
                      ] as const
                    ).map(([id, sender, content], index) => (
                      <MessageScrollerItem
                        key={id}
                        messageId={id}
                        scrollAnchor={index === 0}
                      >
                        <Message align={index === 0 ? "end" : "start"}>
                          <MessageContent>
                            <MessageHeader>{sender}</MessageHeader>
                            <Bubble
                              variant={index === 0 ? "default" : "secondary"}
                              align={index === 0 ? "end" : "start"}
                            >
                              <BubbleContent>{content}</BubbleContent>
                            </Bubble>
                          </MessageContent>
                        </Message>
                      </MessageScrollerItem>
                    ))}
                  </MessageScrollerContent>
                </MessageScrollerViewport>
                <MessageScrollerButton />
              </MessageScroller>
            </MessageScrollerProvider>
          </div>
        </Family>
      </div>
    </section>
  );
}

export function DesignSystemGallery() {
  return (
    <DirectionProvider dir="ltr" direction="ltr">
      <TooltipProvider delayDuration={100}>
        <div
          className="h-screen overflow-y-auto bg-background text-foreground"
          data-testid="design-system-gallery"
        >
          <GalleryHeader />
          <main className="mx-auto flex max-w-screen-2xl flex-col gap-24 px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
            <section className="relative overflow-hidden rounded-3xl border bg-card p-6 sm:p-10 lg:p-14">
              <div className="relative flex max-w-4xl flex-col gap-6">
                <Badge variant="secondary" className="w-fit">
                  <SparklesIcon data-icon="inline-start" />
                  Phase 1 · Design System Foundation
                </Badge>
                <div className="flex flex-col gap-4">
                  <h1 className="font-heading text-4xl font-semibold tracking-tight sm:text-5xl lg:text-6xl">
                    WebEditor 디자인 시스템
                  </h1>
                  <p className="max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
                    통계 전문가가 개발 지식 없이도 신뢰할 수 있는 웹서비스를
                    만드는 데 필요한 shadcn/ui 구성과 의미 상태를 한 화면에서
                    검증합니다.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">
                    <BlocksIcon data-icon="inline-start" />
                    {COMPONENT_FAMILIES.length} component families
                  </Badge>
                  <Badge variant="outline">
                    <Code2Icon data-icon="inline-start" />
                    Radix · Nova
                  </Badge>
                  <Badge variant="outline">
                    <ActivityIcon data-icon="inline-start" />
                    Keyboard ready
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Button asChild>
                    <a href="#foundation">
                      갤러리 시작
                      <ArrowRightIcon data-icon="inline-end" />
                    </a>
                  </Button>
                  <Button variant="outline" asChild>
                    <a href="/">프로젝트 홈</a>
                  </Button>
                </div>
              </div>
            </section>

            <FoundationSection />
            <FormsSection />
            <DataDisplaySection />
            <NavigationSection />
            <OverlaySection />
            <MessagingSection />

            <footer className="flex flex-col gap-4 border-t pt-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
              <span>WebEditor · Semantic tokens · Lucide icons</span>
              <span>내부 경로 /internal/design-system</span>
            </footer>
          </main>
          <Toaster position="bottom-right" />
        </div>
      </TooltipProvider>
    </DirectionProvider>
  );
}
