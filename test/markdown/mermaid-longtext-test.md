# Mermaid 长文本渲染测试

本文档包含多种带**长文本**的 Mermaid 图，用于验证节点文本的自动换行与截断问题。

---

## 1. 长中文句子（应自动按字符换行）

```mermaid
flowchart TD
    A[开始处理一个业务请求] --> B{是否需要执行一个超级长的判断逻辑描述文本来决定下一步走向}
    B -->|Yes 这个分支说明文字也比较长需要完整显示| C[执行某某业务操作模块并且把返回结果持久化到数据库表中完成整个流程]
    B -->|No| D[直接跳过该步骤进入收尾]
    C --> E[记录操作日志并结束本次流程处理]
    D --> E
```

---

## 2. 长英文句子带空格（应按词换行）

```mermaid
flowchart TD
    A[Initialize the application runtime environment] --> B{Check whether the user session token is still valid and not expired}
    B -->|Valid session| C[Load the user profile and cached workspace settings from the local storage]
    B -->|Session expired or invalid| D[Redirect to the login screen and ask the user to authenticate again]
```

---

## 3. 无空格长串 - 长 URL（典型不可断点场景）

```mermaid
flowchart LR
    A[请求发起] --> B{命中缓存?}
    B -->|是| C[读取缓存返回]
    B -->|否| D[回源请求 https://very-long-example.cdn.cloud-provider.com/api/v2/orders/detail?orderId=202608081234567890&expand=items,discount,coupon&fields=id,status,amount,createdAt]
    D --> E[写入缓存并返回]
```

---

## 4. 长 URL / 超长单词混合长句

```mermaid
flowchart TD
    A[配置服务地址 https://api.internal.cluster-01.production.example.com:8443/healthz/v2/readiness 并建立长连接] --> B[健康检查通过后开始消费消息队列任务]
    B --> C{消息类型判断是否是超长关键词 Pneumonoultramicroscopicsilicovolcanoconiosis 开头}
    C -->|是| D[走特殊处理分支对超长词汇做截断分析]
    C -->|否| E[走常规流程处理普通消息体内容]
```

---

## 5. ER 图超长属性与注释

```mermaid
erDiagram
    ORDER ||--|{ ORDER_ITEM : contains
    CUSTOMER {
        string id PK
        string display_name "Customer display name that is extremely long and should ideally wrap inside the attribute area"
        string description "一些非常长的字段描述文本测试测试测试测试测试测试测试测试测试测试测试"
        int total_order_count_with_long_column_identifier "统计该客户累计订单数量的字段"
    }
```

---

## 6. 时序图超长参与者与消息

```mermaid
sequenceDiagram
    participant 移动端 as 移动端Android客户端应用测试测试测试测试
    participant 服务端 as 后端网关服务API服务端测试测试测试测试
    移动端->>服务端: 发送一条内容特别特别长的请求消息用来验证序列图文本是否会自动换行显示而不是被截断掉
    服务端-->>移动端: 返回一条同样特别长的响应消息内容测试测试测试测试测试测试测试测试测试
    Note over 移动端,服务端: 这条备注文字也是相当长的一段内容需要观察它是否会折行还是直接溢出被裁掉
```

---

## 7. 状态图 / 类图长标签

```mermaid
stateDiagram-v2
    [*] --> 空闲中
    空闲中 --> 处理中: 收到一条需要处理的超长事件消息触发状态切换测试测试测试测试
    处理中 --> 暂停: 用户主动暂停了当前正在进行的长时间处理任务流程
    暂停 --> 处理中: 用户恢复执行暂停的任务继续往下跑
    处理中 --> 已完成: 整个处理流程成功跑完收尾归档
```

```mermaid
classDiagram
    class 订单服务 {
        +handleOrderCreatedEvent(payload) with a really long method signature description
        +String 订单号字段名称特别长需要观察能否换行显示测试测试
        -void persistToDatabaseAndNotify()
    }
```
