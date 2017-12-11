'use strict';
const co = require('co');
const stream = require('stream');
const JSONStream = require('JSONStream');

const Dominator = require('./DominatorTree');
const Parser = require('./Parser');

module.exports = function (_common, config, logger, utils, cache, common) {

  function sendMessage(options, message){
    const cb = options.callback;
    const params = options.params.apply(options, [message, Date.now()]);
    return cb(params.message, params.socket);
  }

  /**
   * @param {snapshot} profile
   * @param {object} options
   */
  function parse(profile, options) {
    // 为了兼容更多老 node，不得不继续采用 co + generator 的方式
    return co(_parse, profile, options);

    /**
     * 内部处理逻辑
     */
    function* _parse(profile, options) {
      const limit = options.limit || 5;
      const parser = new Parser(profile, options);
      parser.init();
      yield sendMessage(options, {prefix:'Parser 计算完毕', suffix:'开始计算 Dominator Tree...'});
      // 根据 parser 获取可疑泄漏点
      const result = new Dominator({
        numberOfObjects: parser.realNodeCount,
        inboundIndexList: parser.inboundIndexList,
        outboundIndexList: parser.outboundIndexList,
        gcRootsArray: parser.gcRoots,
        heapSize: parser.heapSizeList
      }, {}).calculate();
      yield sendMessage(options, {prefix:'Dominator Tree 计算完毕', suffix:'分析完成'});
      const total = parser.statistics.total;
      parser.retainedSizes = result.retainedSizes;
      // parser.topDominator = result.topDominator;
      parser.topDominator = result.topDominator.filter(tr => parser.retainedSizes[tr + 2] / total > 0.2);
      return parser;
    }
  }

  /**
   * @param {stream} transform @param {object} options 
   * @return {promise}
   */
  function fetchParserP(transform, options) {
    const isStream = Boolean(transform instanceof stream.Stream);

    return new Promise((resolve, reject) => {
      if (isStream) {
        const parser = JSONStream.parse();
        transform.pipe(parser);

        parser.on('data', heapData => {
          const cb = options.callback;
          const params = options.params.apply(options, [{ prefix: `Memory 流式数据准备完毕`, suffix: `准备开始构建 Parser` }, Date.now()]);
          cb(params.message, params.socket).then(() => parse(heapData, options)).then(resolve).catch(reject);
        });

        parser.on('error', reject);
      } else {
        parse(transform, options).then(resolve).catch(reject);
      }
    });
  }

  return { fetchParserP }
};