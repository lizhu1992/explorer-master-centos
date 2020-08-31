### centos启动此项目(nodejs+mongodb前后端项目)

`node版本：10.16.0`

`源码:https://github.com/ethereumclassic/explorer`

#### 1. windows安装mongo

- https://www.cnblogs.com/abella/p/10318408.html

#### 2. windows安装mongodb可视化工具robot3T或者NoSQLBooster for MongoDB

```js
mongodb语句

show dbs;

use 数据库名；

show tables;

use 表名；

db.表名..insert({a:1,b:1})

db.表名.find({}, {a:1,b:1})
```

#### 3. centos安装mongodb

```js
// 创建mongodb文件夹
mkdir mongodb
// 切换到mongodb文件夹
cd mongodb
// 下载安装包
wget https://fastdl.mongodb.org/linux/mongodb-linux-x86_64-4.0.7.tgz
// 解压安装包
tar -zxvf mongodb-linux-x86_64-4.0.7.tgz 
// 切换到bin目录
cd mongodb-linux-x86_64-4.0.7/bin
// 新建logs和datas文件夹
mkdir logs datas
// 新建mongodb.conf文件
 vim mongodb.conf
  dbpath = /usr/local/mongodb/mongodb-linux-x86_64-4.0.7/bin/datas
  logpath =/usr/local/mongodb/mongodb-linux-x86_64-4.0.7/bin/logs/mongodb.log
  port = 27017
  fork = true
  bind_ip=0.0.0.0
// 执行mongodb.conf文件
./mongodb --config mongodb.conf 
// 配置环境变量
sudo vim /etc/profile
export PATH=/usr/local/mongodb/mongodb-linux-x86_64-4.0.7/bin:$PATH
. /etc/profile
// 将本地数据导出的json表放到mongodb-linux-x86_64-4.0.7/bin
sudo mv *  /usr/local/mongodb/mongodb-linux-x86_64-4.0.7/bin/
// 重命名
mv explorerDB.Account.json account.json
mv explorerDB.Block.json  block.json
mv explorerDB.BlockStat.json blockStat.json
mv explorerDB.Contract.json contract.json
mv explorerDB.Market.json market.json
mv explorerDB.TokenTransfer.json tokenTransfer.json
mv explorerDB.Transaction.json transaction.json
// 将表字段放到表里面
mongoimport -d explorerDB -c block --file /usr/local/mongodb/mongodb-linux-x86_64-4.0.7/bin/block.json 
mongoimport -d explorerDB -c blockStat --file /usr/local/mongodb/mongodb-linux-x86_64-4.0.7/bin/blockStat.json 
mongoimport -d explorerDB -c account --file /usr/local/mongodb/mongodb-linux-x86_64-4.0.7/bin/account.json 
mongoimport -d explorerDB -c contract --file /usr/local/mongodb/mongodb-linux-x86_64-4.0.7/bin/contract.json 
mongoimport -d explorerDB -c market --file /usr/local/mongodb/mongodb-linux-x86_64-4.0.7/bin/market.json 
mongoimport -d explorerDB -c tokenTransfer --file /usr/local/mongodb/mongodb-linux-x86_64-4.0.7/bin/tokenTransfer.json 
mongoimport -d explorerDB -c transaction --file /usr/local/mongodb/mongodb-linux-x86_64-4.0.7/bin/transaction.json 
```

#### 3. 启动项目

```js
启动前执行 npm install -g --unsafe-perm
// 正常启动
npm start
// 后台守护进程
nohup npm start &
   
```

