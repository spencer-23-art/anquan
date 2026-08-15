from dataclasses import dataclass

from app.models.fine_ticket import FineTicketType


SAFETY_REGULATION_SOURCE = "https://www.gov.cn/gongbao/content/2004/content_52954.htm"
QUALITY_REGULATION_SOURCE = "https://nxca.miit.gov.cn/zwgk/zcwj/flfg/art/2021/art_c1c8d42d93004b96ba641a3e01d97858.html"
SAFETY_LAW_SOURCE = "https://www.mem.gov.cn/fw/flfgbz/fg/202107/t20210716_416558.shtml"


@dataclass(frozen=True)
class FineRule:
    id: str
    ticket_type: FineTicketType
    label: str
    legal_basis: str
    technical_basis: str
    keywords: tuple[str, ...]
    source_url: str | None = None
    priority: int = 0
    automatic_min_matches: int = 2

    @property
    def reference(self) -> str:
        parts = [part for part in (self.legal_basis, self.technical_basis) if part]
        return "；".join(parts)


FINE_RULES: tuple[FineRule, ...] = (
    FineRule(
        id="safety-worker-ppe",
        ticket_type=FineTicketType.SAFETY,
        label="作业人员未正确使用劳动防护用品",
        legal_basis="《建设工程安全生产管理条例》（国务院令第393号）第三十三条",
        technical_basis="《建筑施工作业劳动防护用品配备及使用标准》JGJ 184-2009",
        keywords=("安全帽", "未戴帽", "未佩戴", "安全鞋", "反光衣", "防护眼镜", "防护手套", "劳保"),
        source_url=SAFETY_REGULATION_SOURCE,
        priority=20,
    ),
    FineRule(
        id="safety-employer-ppe",
        ticket_type=FineTicketType.SAFETY,
        label="施工单位未配备劳动防护用品",
        legal_basis="《建设工程安全生产管理条例》（国务院令第393号）第三十二条",
        technical_basis="《建筑施工作业劳动防护用品配备及使用标准》JGJ 184-2009",
        keywords=("未提供", "未配备", "未发放", "无安全帽", "无安全带", "无防护用品"),
        source_url=SAFETY_REGULATION_SOURCE,
        priority=30,
    ),
    FineRule(
        id="safety-high-work",
        ticket_type=FineTicketType.SAFETY,
        label="高处作业防坠落措施不足",
        legal_basis="《建设工程安全生产管理条例》（国务院令第393号）第三十三条",
        technical_basis="《建筑施工高处作业安全技术规范》JGJ 80-2016",
        keywords=("高处", "登高", "安全带", "临边", "洞口", "坠落", "高空", "防坠"),
        source_url=SAFETY_REGULATION_SOURCE,
        priority=40,
    ),
    FineRule(
        id="safety-temp-electricity",
        ticket_type=FineTicketType.SAFETY,
        label="施工现场临时用电管理不符合要求",
        legal_basis="《建设工程安全生产管理条例》（国务院令第393号）第三十一条",
        technical_basis="《施工现场临时用电安全技术规范》JGJ 46-2005",
        keywords=("临电", "临时用电", "配电箱", "开关箱", "漏保", "漏电保护", "电缆", "接地", "接零", "三级配电", "二级保护"),
        source_url=SAFETY_REGULATION_SOURCE,
        priority=40,
    ),
    FineRule(
        id="safety-hot-work",
        ticket_type=FineTicketType.SAFETY,
        label="动火作业消防管理不符合要求",
        legal_basis="《建设工程安全生产管理条例》（国务院令第393号）第三十一条",
        technical_basis="《建设工程施工现场消防安全技术规范》GB 50720-2011",
        keywords=("动火", "动火证", "焊接", "热切割", "切割", "明火", "乙炔", "氧气瓶", "气瓶"),
        source_url=SAFETY_REGULATION_SOURCE,
        priority=45,
    ),
    FineRule(
        id="safety-special-work-qualification",
        ticket_type=FineTicketType.SAFETY,
        label="特种作业人员未持证上岗",
        legal_basis="《建设工程安全生产管理条例》（国务院令第393号）第二十五条；《中华人民共和国安全生产法》第三十条",
        technical_basis="《特种作业人员安全技术培训考核管理规定》有关持证上岗的规定",
        keywords=("无证上岗", "特种作业证", "操作证", "上岗证", "证书过期", "证件过期", "未持证", "信号工", "司索", "电工证", "焊工证"),
        source_url=SAFETY_LAW_SOURCE,
        priority=50,
    ),
    FineRule(
        id="safety-scaffold-plan",
        ticket_type=FineTicketType.SAFETY,
        label="脚手架工程专项方案或架体防护不符合要求",
        legal_basis="《建设工程安全生产管理条例》（国务院令第393号）第二十六条",
        technical_basis="《建筑施工扣件式钢管脚手架安全技术规范》JGJ 130-2011",
        keywords=("脚手架", "脚手板", "连墙件", "扫地杆", "剪刀撑", "架体", "专项方案"),
        source_url=SAFETY_REGULATION_SOURCE,
        priority=35,
    ),
    FineRule(
        id="safety-lifting-plan",
        ticket_type=FineTicketType.SAFETY,
        label="起重吊装专项方案或现场作业控制不符合要求",
        legal_basis="《建设工程安全生产管理条例》（国务院令第393号）第二十六条",
        technical_basis="《建筑施工起重吊装工程安全技术规范》JGJ 276-2012",
        keywords=("吊装", "起重", "吊物", "司索", "信号工", "吊装方案", "吊装作业"),
        source_url=SAFETY_REGULATION_SOURCE,
        priority=35,
    ),
    FineRule(
        id="safety-lifting-acceptance",
        ticket_type=FineTicketType.SAFETY,
        label="施工起重机械或自升式设施未经验收投入使用",
        legal_basis="《建设工程安全生产管理条例》（国务院令第393号）第三十五条",
        technical_basis="《建筑施工起重吊装工程安全技术规范》JGJ 276-2012",
        keywords=("塔吊", "施工升降机", "起重机械", "未验收", "验收不合格", "自升式", "提升架"),
        source_url=SAFETY_REGULATION_SOURCE,
        priority=45,
    ),
    FineRule(
        id="safety-general-responsibility",
        ticket_type=FineTicketType.SAFETY,
        label="通用安全生产责任（仅在无更具体依据时使用）",
        legal_basis="《建设工程安全生产管理条例》（国务院令第393号）第四条",
        technical_basis="",
        keywords=(),
        source_url=SAFETY_REGULATION_SOURCE,
        automatic_min_matches=999,
    ),
    FineRule(
        id="quality-concrete-structure",
        ticket_type=FineTicketType.QUALITY,
        label="混凝土或钢筋结构施工质量不符合要求",
        legal_basis="《建设工程质量管理条例》（国务院令第279号）第二十八条",
        technical_basis="《混凝土结构工程施工质量验收规范》GB 50204-2015",
        keywords=("钢筋", "箍筋", "保护层", "混凝土", "振捣", "蜂窝", "麻面", "露筋", "试块"),
        source_url=QUALITY_REGULATION_SOURCE,
        priority=35,
    ),
    FineRule(
        id="quality-material-inspection",
        ticket_type=FineTicketType.QUALITY,
        label="材料、构配件或设备未经检验使用",
        legal_basis="《建设工程质量管理条例》（国务院令第279号）第二十九条",
        technical_basis="《建筑与市政工程施工质量控制通用规范》GB 55032-2022",
        keywords=("未检验", "未送检", "不合格材料", "无合格证", "未复检", "材料进场", "构配件"),
        source_url=QUALITY_REGULATION_SOURCE,
        priority=50,
    ),
    FineRule(
        id="quality-process-control",
        ticket_type=FineTicketType.QUALITY,
        label="工序质量检验或隐蔽工程记录不符合要求",
        legal_basis="《建设工程质量管理条例》（国务院令第279号）第三十条",
        technical_basis="《建筑与市政工程施工质量控制通用规范》GB 55032-2022",
        keywords=("隐蔽", "未验收", "未报验", "工序", "检验记录", "旁站", "质量记录"),
        source_url=QUALITY_REGULATION_SOURCE,
        priority=45,
    ),
    FineRule(
        id="quality-steel-structure",
        ticket_type=FineTicketType.QUALITY,
        label="钢结构施工质量不符合要求",
        legal_basis="《建设工程质量管理条例》（国务院令第279号）第二十八条",
        technical_basis="《钢结构工程施工质量验收标准》GB 50205-2020",
        keywords=("钢结构", "钢构", "钢梁", "钢柱", "焊缝", "高强螺栓", "防腐", "防火涂料"),
        source_url=QUALITY_REGULATION_SOURCE,
        priority=35,
    ),
    FineRule(
        id="quality-masonry",
        ticket_type=FineTicketType.QUALITY,
        label="砌体结构施工质量不符合要求",
        legal_basis="《建设工程质量管理条例》（国务院令第279号）第二十八条",
        technical_basis="《砌体结构工程施工质量验收规范》GB 50203-2011",
        keywords=("砌体", "砌筑", "灰缝", "拉结筋", "构造柱", "砖墙"),
        source_url=QUALITY_REGULATION_SOURCE,
        priority=35,
    ),
    FineRule(
        id="quality-decoration",
        ticket_type=FineTicketType.QUALITY,
        label="装饰装修工程质量不符合要求",
        legal_basis="《建设工程质量管理条例》（国务院令第279号）第二十八条",
        technical_basis="《建筑装饰装修工程质量验收标准》GB 50210-2018",
        keywords=("抹灰", "空鼓", "开裂", "饰面", "墙砖", "地砖", "平整度", "腻子"),
        source_url=QUALITY_REGULATION_SOURCE,
        priority=35,
    ),
    FineRule(
        id="quality-waterproofing",
        ticket_type=FineTicketType.QUALITY,
        label="防水工程施工质量不符合要求",
        legal_basis="《建设工程质量管理条例》（国务院令第279号）第二十八条",
        technical_basis="《建筑与市政工程防水通用规范》GB 55030-2022",
        keywords=("防水", "渗漏", "漏水", "卷材", "涂膜", "闭水", "蓄水"),
        source_url=QUALITY_REGULATION_SOURCE,
        priority=35,
    ),
    FineRule(
        id="quality-general-construction",
        ticket_type=FineTicketType.QUALITY,
        label="通用施工质量责任（仅在无更具体依据时使用）",
        legal_basis="《建设工程质量管理条例》（国务院令第279号）第二十八条",
        technical_basis="",
        keywords=(),
        source_url=QUALITY_REGULATION_SOURCE,
        automatic_min_matches=999,
    ),
)


def get_rule(rule_id: str, ticket_type: FineTicketType) -> FineRule:
    for rule in FINE_RULES:
        if rule.id == rule_id and rule.ticket_type == ticket_type:
            return rule
    raise ValueError("The selected rule does not match the fine ticket type")


def find_rule_matches(ticket_type: FineTicketType, context: str) -> list[tuple[FineRule, tuple[str, ...]]]:
    text = str(context or "")
    matches: list[tuple[FineRule, tuple[str, ...]]] = []
    for rule in FINE_RULES:
        if rule.ticket_type != ticket_type:
            continue
        matched_keywords = tuple(keyword for keyword in rule.keywords if keyword in text)
        matches.append((rule, matched_keywords))
    return sorted(
        matches,
        key=lambda item: (bool(item[1]), len(item[1]), item[0].priority),
        reverse=True,
    )


def recommend_rule_id(ticket_type: FineTicketType, context: str) -> str | None:
    matches = find_rule_matches(ticket_type, context)
    if not matches:
        return None
    rule, matched_keywords = matches[0]
    return rule.id if len(matched_keywords) >= rule.automatic_min_matches else None
