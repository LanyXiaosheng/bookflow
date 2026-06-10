\set ON_ERROR_STOP on

-- Single-row AI settings so the deployed demo opens with visible defaults.
INSERT INTO app_settings (
    id,
    provider,
    base_url,
    api_key,
    model,
    image_model,
    timeout_secs
)
VALUES (
    TRUE,
    :'ai_provider',
    :'ai_base_url',
    :'ai_api_key',
    :'ai_model',
    :'ai_image_model',
    :'ai_timeout_secs'
)
ON CONFLICT (id) DO UPDATE
SET provider = EXCLUDED.provider,
    base_url = EXCLUDED.base_url,
    api_key = EXCLUDED.api_key,
    model = EXCLUDED.model,
    image_model = EXCLUDED.image_model,
    timeout_secs = EXCLUDED.timeout_secs,
    updated_at = NOW();

INSERT INTO users (
    id,
    email,
    display_name,
    password_hash,
    created_at
)
VALUES (
    :'demo_user_id',
    :'demo_email',
    :'demo_display_name',
    :'demo_password_hash',
    TIMESTAMPTZ '2026-06-01 08:00:00+08'
)
ON CONFLICT (id) DO UPDATE
SET email = EXCLUDED.email,
    display_name = EXCLUDED.display_name,
    password_hash = EXCLUDED.password_hash;

INSERT INTO seeds (
    id,
    user_id,
    title,
    track,
    score_title,
    score_opening,
    score_slap,
    score_emotion,
    score_twist,
    score_hook,
    score_finish,
    tier,
    created_at
)
VALUES
    (
        '00000000-0000-4000-8000-000000000101',
        :'demo_user_id',
        '替身新娘反杀局',
        '现代言情·豪门/替身逆袭',
        5, 5, 4, 5, 4, 5, 4,
        'greenlight',
        TIMESTAMPTZ '2026-06-01 09:00:00+08'
    ),
    (
        '00000000-0000-4000-8000-000000000102',
        :'demo_user_id',
        '规则怪谈：夜班电梯',
        '悬疑惊悚·规则怪谈/密闭空间',
        5, 5, 4, 4, 5, 5, 4,
        'greenlight',
        TIMESTAMPTZ '2026-06-01 09:30:00+08'
    ),
    (
        '00000000-0000-4000-8000-000000000103',
        :'demo_user_id',
        '离婚后我爆红了',
        '现代言情·娱乐圈/追妻火葬场',
        5, 4, 5, 5, 4, 4, 5,
        'greenlight',
        TIMESTAMPTZ '2026-06-01 10:00:00+08'
    ),
    (
        '00000000-0000-4000-8000-000000000104',
        :'demo_user_id',
        '冷宫皇后今天翻盘了吗',
        '古代言情·宫斗/逆风翻盘',
        4, 4, 5, 5, 4, 4, 4,
        'greenlight',
        TIMESTAMPTZ '2026-06-01 10:30:00+08'
    ),
    (
        '00000000-0000-4000-8000-000000000105',
        :'demo_user_id',
        '重生后我改写婆媳剧本',
        '现实情感·家庭/女性成长',
        4, 4, 4, 5, 3, 4, 4,
        'backlog',
        TIMESTAMPTZ '2026-06-01 11:00:00+08'
    ),
    (
        '00000000-0000-4000-8000-000000000106',
        :'demo_user_id',
        '他在雨夜说爱我',
        '现代言情·都市/虐恋误会',
        2, 3, 2, 3, 2, 3, 2,
        'reject',
        TIMESTAMPTZ '2026-06-01 11:30:00+08'
    )
ON CONFLICT (id) DO UPDATE
SET user_id = EXCLUDED.user_id,
    title = EXCLUDED.title,
    track = EXCLUDED.track,
    score_title = EXCLUDED.score_title,
    score_opening = EXCLUDED.score_opening,
    score_slap = EXCLUDED.score_slap,
    score_emotion = EXCLUDED.score_emotion,
    score_twist = EXCLUDED.score_twist,
    score_hook = EXCLUDED.score_hook,
    score_finish = EXCLUDED.score_finish,
    tier = EXCLUDED.tier,
    created_at = EXCLUDED.created_at;

INSERT INTO projects (
    id,
    user_id,
    seed_id,
    title,
    track,
    status,
    published_at,
    created_at,
    updated_at,
    deleted_at
)
VALUES
    (
        '00000000-0000-4000-8000-000000000201',
        :'demo_user_id',
        '00000000-0000-4000-8000-000000000101',
        '替身新娘反杀局',
        '现代言情·豪门/替身逆袭',
        'writing',
        NULL,
        TIMESTAMPTZ '2026-06-01 12:00:00+08',
        TIMESTAMPTZ '2026-06-09 19:00:00+08',
        NULL
    ),
    (
        '00000000-0000-4000-8000-000000000202',
        :'demo_user_id',
        '00000000-0000-4000-8000-000000000102',
        '规则怪谈：夜班电梯',
        '悬疑惊悚·规则怪谈/密闭空间',
        'ready',
        NULL,
        TIMESTAMPTZ '2026-06-02 09:00:00+08',
        TIMESTAMPTZ '2026-06-08 10:00:00+08',
        NULL
    ),
    (
        '00000000-0000-4000-8000-000000000203',
        :'demo_user_id',
        '00000000-0000-4000-8000-000000000103',
        '离婚后我爆红了',
        '现代言情·娱乐圈/追妻火葬场',
        'published',
        TIMESTAMPTZ '2026-06-01 20:00:00+08',
        TIMESTAMPTZ '2026-06-01 13:00:00+08',
        TIMESTAMPTZ '2026-06-08 12:00:00+08',
        NULL
    ),
    (
        '00000000-0000-4000-8000-000000000204',
        :'demo_user_id',
        '00000000-0000-4000-8000-000000000104',
        '冷宫皇后今天翻盘了吗',
        '古代言情·宫斗/逆风翻盘',
        'archived',
        TIMESTAMPTZ '2026-05-20 20:00:00+08',
        TIMESTAMPTZ '2026-05-18 18:00:00+08',
        TIMESTAMPTZ '2026-06-07 18:00:00+08',
        NULL
    )
ON CONFLICT (id) DO UPDATE
SET user_id = EXCLUDED.user_id,
    seed_id = EXCLUDED.seed_id,
    title = EXCLUDED.title,
    track = EXCLUDED.track,
    status = EXCLUDED.status,
    published_at = EXCLUDED.published_at,
    created_at = EXCLUDED.created_at,
    updated_at = EXCLUDED.updated_at,
    deleted_at = EXCLUDED.deleted_at;

INSERT INTO chapters (
    id,
    project_id,
    idx,
    title,
    beats,
    body,
    word_count,
    created_at,
    updated_at
)
VALUES
    (
        '00000000-0000-4000-8000-000000000301',
        '00000000-0000-4000-8000-000000000201',
        1,
        '婚礼上的耳光',
        '[{"id":"b1","label":"婚礼翻车","note":"替身在婚礼现场反杀白月光陷阱"},{"id":"b2","label":"埋伏回收","note":"男主发现她提前布下监控证据"}]'::jsonb,
        $$苏晚在婚礼誓词念到一半时，白月光忽然递来那份所谓的孕检单。全场都等着她失态，苏晚却先把大屏切成了后台监控录像。镜头里，孕检单是对方亲手塞进化妆包的，连时间戳都清清楚楚。掌声还没响起，婆婆已经先慌了。顾沉舟第一次正眼看她，像在看一个根本没被他读懂的人。$$,
        864,
        TIMESTAMPTZ '2026-06-01 12:10:00+08',
        TIMESTAMPTZ '2026-06-09 19:10:00+08'
    ),
    (
        '00000000-0000-4000-8000-000000000302',
        '00000000-0000-4000-8000-000000000201',
        2,
        '她不再演了',
        '[{"id":"b3","label":"关系倒转","note":"女主提出契约婚姻新条款"},{"id":"b4","label":"情绪拉满","note":"男主意识到自己才是被拿捏的人"}]'::jsonb,
        $$回到顾家后，苏晚把婚前协议重新拍在桌上。她说自己可以继续做顾太太，但不会再替任何人背锅，也不会再对外维持那副委曲求全的样子。顾沉舟本想冷处理，却被她一句“你若想保白月光，就别再来求我稳局”逼得沉默。局面第一次从她的隐忍，变成了她的主导。$$,
        913,
        TIMESTAMPTZ '2026-06-02 08:10:00+08',
        TIMESTAMPTZ '2026-06-09 19:20:00+08'
    ),
    (
        '00000000-0000-4000-8000-000000000303',
        '00000000-0000-4000-8000-000000000202',
        1,
        '午夜电梯停在十三层',
        '[{"id":"b1","label":"规则抛出","note":"每晚零点后不要在电梯里说出真实姓名"},{"id":"b2","label":"首次触发","note":"新人值班员误触禁忌"}]'::jsonb,
        $$写字楼的夜班守则只有一页，其中第七条被人用红笔重重圈住：零点以后，电梯如果停在十三层，千万别报自己的名字。林栀原以为这只是保安之间吓唬新人的段子，直到电梯门真的在十三层打开，门外却是一整层黑着灯、看不见出口的走廊。她听见有人在门外轻轻问：你是林栀吗。$$,
        990,
        TIMESTAMPTZ '2026-06-02 09:20:00+08',
        TIMESTAMPTZ '2026-06-08 10:10:00+08'
    ),
    (
        '00000000-0000-4000-8000-000000000304',
        '00000000-0000-4000-8000-000000000202',
        2,
        '监控里多了一个她',
        '[{"id":"b3","label":"监控异象","note":"监控画面比现实多出一个人影"},{"id":"b4","label":"反转推进","note":"原来上一任夜班员也叫林栀"}]'::jsonb,
        $$第二天调监控时，林栀在回放里看见了自己。准确地说，是另一个提前五秒做出同样动作的“她”。值班日志被翻到最后一页，上一任失踪夜班员的签名赫然写着林栀两个字，连字迹都和她一模一样。她终于意识到，这栋楼在不断复制一个能活过第七条规则的人。$$,
        1024,
        TIMESTAMPTZ '2026-06-03 09:20:00+08',
        TIMESTAMPTZ '2026-06-08 10:20:00+08'
    ),
    (
        '00000000-0000-4000-8000-000000000305',
        '00000000-0000-4000-8000-000000000203',
        1,
        '离婚热搜第一天',
        '[{"id":"b1","label":"热搜爆点","note":"离婚声明和偷拍视频同时爆出"},{"id":"b2","label":"情绪压强","note":"女主决定不解释，直接开播"}]'::jsonb,
        $$沈知微的离婚声明发出去十分钟后，前夫和新人的偷拍视频就跟着上了热搜。所有人都在等她发疯，她却反手开了直播，穿着最简单的白衬衫坐在镜头前，只说一句：今天开始，我只为自己营业。弹幕先是质疑，随后因为她当场拆穿偷拍视频摆拍而彻底倒向她。$$,
        1086,
        TIMESTAMPTZ '2026-06-01 13:20:00+08',
        TIMESTAMPTZ '2026-06-08 12:10:00+08'
    ),
    (
        '00000000-0000-4000-8000-000000000306',
        '00000000-0000-4000-8000-000000000203',
        2,
        '前夫求复合也要排队',
        '[{"id":"b3","label":"打脸升级","note":"前夫带资源上门却被拒之门外"},{"id":"b4","label":"事业线拉升","note":"女主拿下大IP女主角"}]'::jsonb,
        $$顾承砚带着投资合同赶到片场时，沈知微正穿着戏服试最后一场爆发戏。她没看那份合同，只让助理把排号单递过去，说想谈合作的人很多，前夫也得排队。当天夜里，她拿下年度大IP女主角，顾承砚却因为偷拍视频背后的资本操作被公开点名。$$,
        1118,
        TIMESTAMPTZ '2026-06-02 13:20:00+08',
        TIMESTAMPTZ '2026-06-08 12:20:00+08'
    ),
    (
        '00000000-0000-4000-8000-000000000307',
        '00000000-0000-4000-8000-000000000204',
        1,
        '废后回宫第一刀',
        '[{"id":"b1","label":"回宫亮相","note":"废后以罪臣之女身份重回后宫"},{"id":"b2","label":"初次立威","note":"她借册封礼直接掀了贵妃的局"}]'::jsonb,
        $$温照雪再入宫那日，人人都等着看她低头。她却在册封礼上当众揭出贵妃偷换贡绸、借机栽赃六宫的证据，把原本给自己的下马威变成了第一场立威。皇帝看着她时，终于想起当年那个被他亲手送进冷宫的女人，从来都不是任人摆布的软骨头。$$,
        935,
        TIMESTAMPTZ '2026-05-18 18:20:00+08',
        TIMESTAMPTZ '2026-06-07 18:20:00+08'
    )
ON CONFLICT (id) DO UPDATE
SET project_id = EXCLUDED.project_id,
    idx = EXCLUDED.idx,
    title = EXCLUDED.title,
    beats = EXCLUDED.beats,
    body = EXCLUDED.body,
    word_count = EXCLUDED.word_count,
    created_at = EXCLUDED.created_at,
    updated_at = EXCLUDED.updated_at;

INSERT INTO project_artifacts (
    id,
    project_id,
    kind,
    version,
    content,
    created_at
)
VALUES
    (
        '00000000-0000-4000-8000-000000000401',
        '00000000-0000-4000-8000-000000000201',
        'readme',
        1,
        $$# 替身新娘反杀局

- 赛道：现代言情·豪门/替身逆袭
- 核心卖点：婚礼翻车、白月光栽赃、女主反杀、契约婚姻反转
- 目标情绪：爽、燃、打脸、暧昧升温$$,
        TIMESTAMPTZ '2026-06-01 12:05:00+08'
    ),
    (
        '00000000-0000-4000-8000-000000000402',
        '00000000-0000-4000-8000-000000000201',
        'character_setup',
        1,
        $$## 角色总表
- 女主：苏晚，清醒克制，擅长布局证据链
- 男主：顾沉舟，外冷内压，习惯掌控局面
- 白月光：林清柔，擅长利用舆论和长辈施压

## 感情线
先婚后爱，互相试探，打脸中升温。$$,
        TIMESTAMPTZ '2026-06-01 12:06:00+08'
    ),
    (
        '00000000-0000-4000-8000-000000000403',
        '00000000-0000-4000-8000-000000000201',
        'outline',
        1,
        $$## 故事主线
1. 婚礼翻车，女主当众反杀
2. 契约婚姻重新议价
3. 白月光再设局，男主逐步站队女主
4. 真相回收，感情破冰$$,
        TIMESTAMPTZ '2026-06-01 12:07:00+08'
    ),
    (
        '00000000-0000-4000-8000-000000000404',
        '00000000-0000-4000-8000-000000000202',
        'readme',
        1,
        $$# 规则怪谈：夜班电梯

- 赛道：悬疑惊悚·规则怪谈
- 主爆点：十三层、电梯复制人、夜班规则、循环求生$$,
        TIMESTAMPTZ '2026-06-02 09:05:00+08'
    ),
    (
        '00000000-0000-4000-8000-000000000405',
        '00000000-0000-4000-8000-000000000202',
        'character_setup',
        1,
        $$## 角色总表
- 女主：林栀，夜班值班员，观察力极强
- 失踪前任：另一位“林栀”，疑似被规则复制
- 保安队长：周既安，知道部分真相却不敢说全$$,
        TIMESTAMPTZ '2026-06-02 09:06:00+08'
    ),
    (
        '00000000-0000-4000-8000-000000000406',
        '00000000-0000-4000-8000-000000000202',
        'outline',
        1,
        $$## 十章细纲
1. 新人值夜班
2. 十三层首次开启
3. 监控出现双人影
4. 规则被验证
5. 失踪夜班员真相浮出$$,
        TIMESTAMPTZ '2026-06-02 09:07:00+08'
    ),
    (
        '00000000-0000-4000-8000-000000000407',
        '00000000-0000-4000-8000-000000000203',
        'readme',
        1,
        $$# 离婚后我爆红了

- 赛道：现代言情·娱乐圈/追妻火葬场
- 核心冲突：离婚热搜、前夫公关、女主事业翻红
- 情绪承诺：打脸、复仇、事业爽感$$,
        TIMESTAMPTZ '2026-06-01 13:05:00+08'
    ),
    (
        '00000000-0000-4000-8000-000000000408',
        '00000000-0000-4000-8000-000000000203',
        'character_setup',
        1,
        $$## 角色总表
- 女主：沈知微，顶流演员，情绪稳定但记仇
- 前夫：顾承砚，资本强势，习惯掌控
- 经纪人：许昭宁，执行力强，擅长控场

## 正文硬约束
所有打脸节点都要带舆论回响和事业收益。$$,
        TIMESTAMPTZ '2026-06-01 13:06:00+08'
    ),
    (
        '00000000-0000-4000-8000-000000000409',
        '00000000-0000-4000-8000-000000000203',
        'outline',
        1,
        $$## 故事主线
1. 离婚声明引爆舆论
2. 前夫和新人反咬
3. 女主靠直播翻盘
4. 拿下大IP女主角
5. 前夫公开跌落$$,
        TIMESTAMPTZ '2026-06-01 13:07:00+08'
    ),
    (
        '00000000-0000-4000-8000-000000000410',
        '00000000-0000-4000-8000-000000000203',
        'publish_post',
        1,
        $$# 离婚后我爆红了

我发离婚声明那天，前夫和新人偷拍视频同时登顶热搜。所有人都在等我哭，等我崩，等我把体面撕碎。可我只是开了直播，对着镜头笑了一下：“今天开始，我只为自己营业。”$$,
        TIMESTAMPTZ '2026-06-08 11:00:00+08'
    ),
    (
        '00000000-0000-4000-8000-000000000411',
        '00000000-0000-4000-8000-000000000203',
        'side_dishes',
        1,
        $$## 配套物料
- 标题备选：离婚后我靠直播杀疯了
- 金句：前夫求复合？先去拿号
- 评论区引导：你见过最爽的离婚反杀是什么？$$,
        TIMESTAMPTZ '2026-06-08 11:10:00+08'
    ),
    (
        '00000000-0000-4000-8000-000000000412',
        '00000000-0000-4000-8000-000000000203',
        'book_summary',
        1,
        $$## 全书汇总
沈知微在离婚热搜中把被动局翻成事业局，前夫每一次想用资本压她，都会成为她下一次爆红的助推器。故事主轴是“离婚不是跌落，而是女主重新掌握叙事权”。$$,
        TIMESTAMPTZ '2026-06-08 11:20:00+08'
    ),
    (
        '00000000-0000-4000-8000-000000000413',
        '00000000-0000-4000-8000-000000000203',
        'book_polished',
        1,
        $$## 全书优化版
加强沈知微每次打脸后的事业收益反馈，让“热搜-舆论-资源升级”形成闭环；同时压缩前夫内心戏，把更多笔墨放在女主主动出击的爽点上。$$,
        TIMESTAMPTZ '2026-06-08 11:30:00+08'
    ),
    (
        '00000000-0000-4000-8000-000000000414',
        '00000000-0000-4000-8000-000000000203',
        'story_image',
        1,
        $${
  "model": "gpt-image-2",
  "prompt": "A dramatic tomato-fiction cover for a divorced actress turning public scandal into a comeback.",
  "mime_type": "image/png",
  "data_url": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5WQAAAAASUVORK5CYII=",
  "title_text": "离婚后我爆红了",
  "cover_size": "1024x1536",
  "author_name": "演示作者",
  "show_author": true
}$$,
        TIMESTAMPTZ '2026-06-08 11:40:00+08'
    ),
    (
        '00000000-0000-4000-8000-000000000415',
        '00000000-0000-4000-8000-000000000204',
        'readme',
        1,
        $$# 冷宫皇后今天翻盘了吗

- 赛道：古代言情·宫斗/逆风翻盘
- 核心卖点：废后回宫、贵妃设局、旧情与权谋对撞$$,
        TIMESTAMPTZ '2026-05-18 18:05:00+08'
    ),
    (
        '00000000-0000-4000-8000-000000000416',
        '00000000-0000-4000-8000-000000000204',
        'publish_post',
        1,
        $$我是被废三年的皇后，也是今日被重新召回后宫的罪臣之女。所有人都等着看我跪下谢恩，可我抬眼第一件事，就是请内务府把贵妃献上的贡绸当众展开。$$,
        TIMESTAMPTZ '2026-06-06 18:00:00+08'
    )
ON CONFLICT (id) DO UPDATE
SET project_id = EXCLUDED.project_id,
    kind = EXCLUDED.kind,
    version = EXCLUDED.version,
    content = EXCLUDED.content,
    created_at = EXCLUDED.created_at;

INSERT INTO project_reviews (
    id,
    project_id,
    stage,
    published_at,
    data_recorded,
    read_count,
    completion_rate,
    engagement_count,
    overall_result,
    title_result,
    hook_result,
    emotion_result,
    success_reason,
    failure_reason,
    continue_track,
    reusable_conclusion,
    next_action,
    created_at,
    updated_at
)
VALUES
    (
        '00000000-0000-4000-8000-000000000501',
        '00000000-0000-4000-8000-000000000203',
        '24h',
        TIMESTAMPTZ '2026-06-01 20:00:00+08',
        TRUE,
        125000,
        0.71,
        8900,
        '爆',
        '标题即冲突',
        '开篇即热搜',
        '离婚后的事业线给足满足感',
        '打脸与事业收益同步出现，读者连续获得反馈',
        NULL,
        '继续做离婚翻红+前夫打脸',
        '每次反杀都要有舆论/资源回收',
        '补做 72h 复盘，强化中段资源升级节奏',
        TIMESTAMPTZ '2026-06-02 20:00:00+08',
        TIMESTAMPTZ '2026-06-02 20:00:00+08'
    ),
    (
        '00000000-0000-4000-8000-000000000502',
        '00000000-0000-4000-8000-000000000204',
        '24h',
        TIMESTAMPTZ '2026-05-20 20:00:00+08',
        TRUE,
        86000,
        0.63,
        5200,
        '平',
        '宫斗身份差有吸引力',
        '回宫第一刀有效',
        '情绪线稳，但甜虐比例还能更极致',
        '第一章立威节点完成度高',
        NULL,
        '宫斗+逆袭可以继续',
        '古言宫斗需要更快给读者立威回报',
        '补完 72h、7d 长周期复盘',
        TIMESTAMPTZ '2026-05-21 20:00:00+08',
        TIMESTAMPTZ '2026-05-21 20:00:00+08'
    ),
    (
        '00000000-0000-4000-8000-000000000503',
        '00000000-0000-4000-8000-000000000204',
        '72h',
        TIMESTAMPTZ '2026-05-20 20:00:00+08',
        TRUE,
        148000,
        0.58,
        9100,
        '平',
        '封面和标题匹配度高',
        '中段钩子略弱',
        '皇帝与女主旧情线拉扯有效',
        '读者对废后回宫设定有持续兴趣',
        NULL,
        '宫斗逆袭仍可做',
        '72h 后必须补一个大回收节点',
        '7d 复盘时重点看后半段付费留存',
        TIMESTAMPTZ '2026-05-23 20:00:00+08',
        TIMESTAMPTZ '2026-05-23 20:00:00+08'
    ),
    (
        '00000000-0000-4000-8000-000000000504',
        '00000000-0000-4000-8000-000000000204',
        '7d',
        TIMESTAMPTZ '2026-05-20 20:00:00+08',
        TRUE,
        221000,
        0.49,
        12600,
        '平',
        '标题稳',
        '章节末尾需要更狠的反转',
        '情感拉扯稳定但冲突升级不够快',
        '世界观稳定，适合继续做同赛道',
        NULL,
        '保留宫斗逆袭赛道',
        '长线宫斗要让每卷都有一场公开立威',
        '归档并沉淀宫斗爆点模板',
        TIMESTAMPTZ '2026-05-27 20:00:00+08',
        TIMESTAMPTZ '2026-05-27 20:00:00+08'
    )
ON CONFLICT (id) DO UPDATE
SET project_id = EXCLUDED.project_id,
    stage = EXCLUDED.stage,
    published_at = EXCLUDED.published_at,
    data_recorded = EXCLUDED.data_recorded,
    read_count = EXCLUDED.read_count,
    completion_rate = EXCLUDED.completion_rate,
    engagement_count = EXCLUDED.engagement_count,
    overall_result = EXCLUDED.overall_result,
    title_result = EXCLUDED.title_result,
    hook_result = EXCLUDED.hook_result,
    emotion_result = EXCLUDED.emotion_result,
    success_reason = EXCLUDED.success_reason,
    failure_reason = EXCLUDED.failure_reason,
    continue_track = EXCLUDED.continue_track,
    reusable_conclusion = EXCLUDED.reusable_conclusion,
    next_action = EXCLUDED.next_action,
    created_at = EXCLUDED.created_at,
    updated_at = EXCLUDED.updated_at;

INSERT INTO notifications (
    id,
    user_id,
    category,
    level,
    status,
    title,
    body,
    action_label,
    action_href,
    source_type,
    source_id,
    fingerprint,
    read_at,
    resolved_at,
    created_at,
    updated_at
)
VALUES
    (
        '00000000-0000-4000-8000-000000000601',
        :'demo_user_id',
        'production',
        'warning',
        'unread',
        '待复盘项目 2 篇',
        '《离婚后我爆红了》缺 72h / 7d 复盘，《冷宫皇后今天翻盘了吗》可查看历史复盘模板。',
        '去复盘',
        '/review',
        'review',
        '00000000-0000-4000-8000-000000000203',
        'demo-review-pending',
        NULL,
        NULL,
        TIMESTAMPTZ '2026-06-09 09:00:00+08',
        TIMESTAMPTZ '2026-06-09 09:00:00+08'
    ),
    (
        '00000000-0000-4000-8000-000000000602',
        :'demo_user_id',
        'ai',
        'info',
        'unread',
        'AI 已生成角色设定',
        '《替身新娘反杀局》的角色设定已经生成，可以继续确认后产出大纲。',
        '查看项目',
        '/projects/00000000-0000-4000-8000-000000000201',
        'artifact',
        '00000000-0000-4000-8000-000000000402',
        'demo-character-setup-ready',
        NULL,
        NULL,
        TIMESTAMPTZ '2026-06-09 10:00:00+08',
        TIMESTAMPTZ '2026-06-09 10:00:00+08'
    ),
    (
        '00000000-0000-4000-8000-000000000603',
        :'demo_user_id',
        'system',
        'info',
        'read',
        'AI 设置已写入演示默认值',
        '当前环境使用演示占位 AI 配置；如果要接真实模型，请去设置页更新。 ',
        '前往设置',
        '/settings',
        'settings',
        'app_settings',
        'demo-settings-seeded',
        TIMESTAMPTZ '2026-06-09 11:00:00+08',
        NULL,
        TIMESTAMPTZ '2026-06-09 11:00:00+08',
        TIMESTAMPTZ '2026-06-09 11:00:00+08'
    ),
    (
        '00000000-0000-4000-8000-000000000604',
        :'demo_user_id',
        'production',
        'info',
        'resolved',
        '发布稿已沉淀为样板',
        '《冷宫皇后今天翻盘了吗》的发布稿和复盘已归档，适合作为古言宫斗模板参考。',
        '查看项目',
        '/projects/00000000-0000-4000-8000-000000000204',
        'project',
        '00000000-0000-4000-8000-000000000204',
        'demo-archived-template',
        TIMESTAMPTZ '2026-06-08 09:00:00+08',
        TIMESTAMPTZ '2026-06-08 09:30:00+08',
        TIMESTAMPTZ '2026-06-08 09:00:00+08',
        TIMESTAMPTZ '2026-06-08 09:30:00+08'
    )
ON CONFLICT (id) DO UPDATE
SET user_id = EXCLUDED.user_id,
    category = EXCLUDED.category,
    level = EXCLUDED.level,
    status = EXCLUDED.status,
    title = EXCLUDED.title,
    body = EXCLUDED.body,
    action_label = EXCLUDED.action_label,
    action_href = EXCLUDED.action_href,
    source_type = EXCLUDED.source_type,
    source_id = EXCLUDED.source_id,
    fingerprint = EXCLUDED.fingerprint,
    read_at = EXCLUDED.read_at,
    resolved_at = EXCLUDED.resolved_at,
    created_at = EXCLUDED.created_at,
    updated_at = EXCLUDED.updated_at;

INSERT INTO ai_seed_drafts (
    id,
    user_id,
    track,
    title,
    score,
    total_score,
    why_buy,
    batch_id,
    created_at
)
VALUES
    (
        '00000000-0000-4000-8000-000000000701',
        :'demo_user_id',
        '现实情感·家庭/女性成长',
        '婆婆直播控诉我啃老后全网翻车',
        '{"title":4,"opening":5,"slap":5,"emotion":4,"twist":4,"hook":4,"finish":4}'::jsonb,
        30,
        '家庭矛盾自带传播性，直播翻车与身份反转适合高情绪短篇。',
        '00000000-0000-4000-8000-000000000801',
        TIMESTAMPTZ '2026-06-09 13:00:00+08'
    ),
    (
        '00000000-0000-4000-8000-000000000702',
        :'demo_user_id',
        '现实情感·家庭/女性成长',
        '我给全家断供后他们跪着求我回去',
        '{"title":4,"opening":4,"slap":5,"emotion":5,"twist":3,"hook":4,"finish":5}'::jsonb,
        30,
        '断供题材冲突直接，适合做高强度打脸与女性觉醒路线。',
        '00000000-0000-4000-8000-000000000801',
        TIMESTAMPTZ '2026-06-09 13:01:00+08'
    )
ON CONFLICT (id) DO UPDATE
SET user_id = EXCLUDED.user_id,
    track = EXCLUDED.track,
    title = EXCLUDED.title,
    score = EXCLUDED.score,
    total_score = EXCLUDED.total_score,
    why_buy = EXCLUDED.why_buy,
    batch_id = EXCLUDED.batch_id,
    created_at = EXCLUDED.created_at;
