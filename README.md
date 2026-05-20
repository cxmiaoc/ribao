# 医院运维日报

一个用于医院运维的简洁记录工具。每条记录只填写三项：

- 地点：例如某科室、几号位、设备位置
- 故障：发生了什么问题
- 解决：如何处理或最终怎么解决

一天可以保存很多条记录。右侧选择查询日期后，只显示这一天的记录。

## 本地测试

```bash
npm run serve
```

打开：

```text
http://localhost:4173
```

也可以直接双击 `index.html` 测试基础功能。

## 备份

页面里可以导出和导入 JSON 备份。数据默认保存在浏览器或 Android WebView 的本地存储中，卸载 App 前建议先导出备份。

## 打包 APK

安装 Android Studio、Java 和 Android SDK 后执行：

```bash
npm run cap:init
npm run prepare:www
npm run cap:add-android
npm run cap:sync
npm run cap:open
```

Android Studio 打开后选择：

```text
Build > Build Bundle(s) / APK(s) > Build APK(s)
```
