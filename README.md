# dsh-memory-router

按工作区自动切换记忆策略的 DSH 插件。约 260 行，零运行时依赖。

## 它做什么

| 工作区 | 行为 | 每轮成本 |
| --- | --- | --- |
| 日常（`daily` 列表内） | 自动注入「`07-记忆\索引.md` + 该工作区 Markdown 文件清单」 | 约 300 token |
| 其他（开发） | 完全不注入 | 0 |

判定依据是会话的 `cwd`，所以同一个 DSH 里开不同工作区的会话，行为自动不同。

## 配置

`<DSH_HOME>\memory-router.json`（通常是 `C:\Users\<你>\.dsh\memory-router.json`）：

```json
{
  "enabled": true,
  "daily": ["D:\\日常"],
  "maxContextFiles": 20
}
```

- `daily`：日常模式的工作区路径，子目录自动包含
- `maxContextFiles`：注入的上下文文件条数上限，设 0 则不列文件
- 文件不存在时用内置默认（`D:\日常`）
- 改完不需要重启，几秒内生效（配置有 4 秒缓存）

## 注入内容长什么样

```
【记忆区 · 日常模式，自动加载】

## 记忆索引
（07-记忆\索引.md 的全文）

## 上下文文件
- `01-笔记\装修-20261023.md` — 房间改造记录（2026-10-23）
- `02-资料\体检报告.md` — （无标题）（2026-10-19）

> 索引里相关的条目再用 read 打开，无关的忽略。
```

## 安装

profile 的 `package.json` 加依赖并写进 `dsh.profile.bundles`，然后重启 DSH：

```json
{
  "dependencies": { "dsh-memory-router": "link:D:/程序/03-项目/dsh-memory-router" },
  "dsh": { "profile": { "bundles": ["...", "dsh-memory-router"] } }
}
```

## 卸载

从 `bundles` 和 `dependencies` 里删掉这两行，重启即可。插件不写任何状态到磁盘。
