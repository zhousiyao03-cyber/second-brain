/**
 * Lightweight tokenizer for Chinese + Latin mixed text.
 * Chinese: forward-max-match with a built-in dictionary.
 * Latin: regex extraction of [a-z0-9._-]+ tokens.
 * Stopwords: via `stopword` package (50+ languages).
 */

import { removeStopwords, eng, zho } from "stopword";

const CJK_RANGE_REGEX = /[\u3400-\u9fff\uf900-\ufaff]+/g;
const LATIN_TOKEN_REGEX = /[a-z0-9][a-z0-9._-]{1,}/gi;
const MIN_TOKEN_LENGTH = 2;

/**
 * Common Chinese terms for knowledge management / tech / daily use.
 * Forward-max-match tries longest match first (up to 4 chars).
 */
const DICTIONARY = new Set([
  // Tech — general
  "性能", "优化", "性能优化", "前端", "后端", "全栈",
  "框架", "组件", "渲染", "状态", "管理", "状态管理",
  "路由", "部署", "测试", "单元测试", "接口", "数据",
  "数据库", "缓存", "索引", "分页", "搜索", "查询",
  "配置", "环境", "变量", "环境变量", "函数", "方法",
  "类型", "模块", "依赖", "打包", "编译", "构建",
  "发布", "版本", "日志", "监控", "报警", "告警",
  "错误", "异常", "调试", "排查", "修复", "重构",
  "迁移", "升级", "回滚", "备份", "恢复",
  "权限", "认证", "授权", "登录", "注册",
  "加密", "解密", "安全", "漏洞",
  "并发", "异步", "同步", "线程", "进程",
  "内存", "泄漏", "溢出", "调优",
  "代码", "审查", "代码审查", "代码质量",
  "算法", "架构", "设计", "模式", "设计模式",
  "服务", "微服务", "容器", "集群",
  "网络", "请求", "响应", "协议",
  "文件", "目录", "路径",
  "注释", "文档", "规范",

  // Knowledge / note-taking
  "知识", "知识库", "笔记", "书签", "标签",
  "分类", "归档", "收藏", "导入", "导出",
  "编辑", "删除", "创建", "更新", "修改",
  "模板", "格式", "样式",
  "链接", "引用", "关联", "嵌入",

  // Work / productivity
  "工作", "进展", "复盘", "总结", "计划",
  "目标", "任务", "项目", "需求", "方案",
  "会议", "讨论", "决策", "反馈", "评审",
  "排期", "优先级", "里程碑", "交付",
  "团队", "协作", "沟通",

  // Learning
  "学习", "教程", "课程", "练习", "实践",
  "概念", "原理", "理论", "思路", "思考",
  "问题", "解决", "方案", "经验", "技巧",
  "入门", "进阶", "精通",

  // Daily / life
  "日记", "生活", "健康", "运动", "饮食",
  "阅读", "写作", "记录", "回顾", "反思",
  "时间", "效率", "习惯",
  "旅行", "摄影", "音乐", "电影",
  "财务", "预算", "支出", "收入", "投资",
]);

/**
 * Compound words → sub-tokens mapping.
 * When a compound word is matched, its sub-tokens are also emitted
 * so that partial queries still match.
 */
const COMPOUND_WORDS: Record<string, string[]> = {
  "性能优化": ["性能", "优化"],
  "状态管理": ["状态", "管理"],
  "数据库": ["数据"],
  "知识库": ["知识"],
  "环境变量": ["环境", "变量"],
  "代码审查": ["代码", "审查"],
  "代码质量": ["代码", "质量"],
  "设计模式": ["设计", "模式"],
  "单元测试": ["单元", "测试"],
};

/**
 * Forward-max-match Chinese segmentation.
 * Tries longest dictionary entry first (up to 4 chars).
 * Also emits sub-tokens for compound words.
 */
function segmentCjk(text: string): string[] {
  const tokens: string[] = [];
  let i = 0;

  while (i < text.length) {
    let matched = "";
    for (let len = Math.min(4, text.length - i); len >= 2; len--) {
      const candidate = text.slice(i, i + len);
      if (DICTIONARY.has(candidate)) {
        matched = candidate;
        break;
      }
    }

    if (matched) {
      tokens.push(matched);
      const subs = COMPOUND_WORDS[matched];
      if (subs) tokens.push(...subs);
      i += matched.length;
    } else {
      i += 1;
    }
  }

  return tokens;
}

/**
 * Tokenize mixed Chinese + Latin text.
 * - Chinese: dictionary-based forward-max-match
 * - Latin: regex extraction
 * - Stopwords removed via `stopword` package (English + Chinese)
 */
export function tokenize(text: string): string[] {
  const lower = text.toLowerCase();

  const latinTokens = (lower.match(LATIN_TOKEN_REGEX) ?? [])
    .filter((t) => t.length >= MIN_TOKEN_LENGTH);

  const cjkSegments = lower.match(CJK_RANGE_REGEX) ?? [];
  const cjkTokens = cjkSegments.flatMap((seg) => segmentCjk(seg));

  const all = [...latinTokens, ...cjkTokens];
  const filtered = removeStopwords(removeStopwords(all, eng), zho);

  return [...new Set(filtered)];
}

/**
 * Tokenize for indexing — same logic but keeps duplicates
 * for MiniSearch term frequency counting.
 */
export function tokenizeForIndex(text: string): string[] {
  const lower = text.toLowerCase();

  const latinTokens = (lower.match(LATIN_TOKEN_REGEX) ?? [])
    .filter((t) => t.length >= MIN_TOKEN_LENGTH);

  const cjkSegments = lower.match(CJK_RANGE_REGEX) ?? [];
  const cjkTokens = cjkSegments.flatMap((seg) => segmentCjk(seg));

  const all = [...latinTokens, ...cjkTokens];
  return removeStopwords(removeStopwords(all, eng), zho);
}
