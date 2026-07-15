const app = getApp();

// API 基础配置
const BASE_URL = 'http://localhost:8080';

/**
 * 封装请求
 */
function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const token = wx.getStorageSync('token') || '';
    wx.request({
      url: BASE_URL + url,
      method: options.method || 'GET',
      data: options.data || {},
      header: {
        'Content-Type': 'application/json',
        'authentication': token
      },
      success(res) {
        if (res.statusCode === 200 && res.data && res.data.code === 1) {
          resolve(res.data.data);
        } else if (res.statusCode === 401) {
          wx.showToast({ title: '请先登录', icon: 'none' });
          reject(new Error('未登录'));
        } else {
          wx.showToast({ title: res.data?.msg || '请求失败', icon: 'none' });
          reject(new Error(res.data?.msg || '请求失败'));
        }
      },
      fail(err) {
        wx.showToast({ title: '网络错误', icon: 'none' });
        reject(err);
      }
    });
  });
}

Page({
  data: {
    messageList: [],
    inputValue: '',
    currentSessionId: null,   // 当前会话ID
    sessions: [],             // 会话列表
    showSessions: false,      // 是否显示会话列表侧边栏
    orderDishNumber: 0,
    orderDishPrice: '0.00',
    orderAndUserInfo: [],
    openCartPopup: false
  },

  onLoad: function() {
    this.loadCartFromStore();
    this.initChat();
  },

  onShow: function() {
    this.loadCartFromStore();
  },

  // ==================== 初始化 ====================

  initChat: function() {
    // 尝试从本地存储读取上次的会话ID
    const lastSessionId = wx.getStorageSync('ai_last_session_id');
    if (lastSessionId) {
      this.setData({ currentSessionId: lastSessionId });
      this.loadMessages(lastSessionId);
    } else {
      // 没有历史会话，显示欢迎消息
      this.setData({
        messageList: [{
          id: Date.now(),
          role: 'assistant',
          content: '您好！我是您的智能点餐助手，告诉我您的口味偏好或者想吃什么，我会为您推荐美味菜品！'
        }]
      });
    }
  },

  // 加载会话消息历史
  loadMessages: function(sessionId) {
    const that = this;
    request(`/user/ai/sessions/${sessionId}/messages`).then(function(messages) {
      if (messages && messages.length > 0) {
        const formattedMessages = messages.map(function(msg) {
          return {
            id: msg.id,
            role: msg.role,
            content: msg.content,
            createTime: msg.createTime
          };
        });
        that.setData({ messageList: formattedMessages });
        that.scrollToBottom();
      } else {
        that.setData({
          messageList: [{
            id: Date.now(),
            role: 'assistant',
            content: '您好！我是您的智能点餐助手，告诉我您的口味偏好或者想吃什么，我会为您推荐美味菜品！'
          }]
        });
      }
    }).catch(function() {
      // 加载失败，显示默认欢迎语
      that.setData({
        messageList: [{
          id: Date.now(),
          role: 'assistant',
          content: '您好！我是您的智能点餐助手，告诉我您的口味偏好或者想吃什么，我会为您推荐美味菜品！'
        }]
      });
    });
  },

  // 加载会话列表
  loadSessions: function() {
    const that = this;
    request('/user/ai/sessions').then(function(sessions) {
      that.setData({ sessions: sessions || [] });
    }).catch(function() {
      // 忽略错误
    });
  },

  // ==================== 购物车（与首页共享后端数据） ====================

  loadCartFromStore: function() {
    const that = this;
    request('/user/shoppingCart/list').then(function(list) {
      const orderListData = list || [];
      that.setData({
        orderAndUserInfo: orderListData,
        ...that.computeCartTotals(orderListData)
      });
      // 同步购物车数量到消息列表中的菜品卡片
      that.syncDishNumbers(orderListData);
    }).catch(function() {
      // 未登录或请求失败
    });
  },

  // 将购物车中的菜品数量同步到消息列表的 dishes 中
  syncDishNumbers: function(cartList) {
    const cartMap = {};
    cartList.forEach(function(item) {
      cartMap[item.dishId] = item.number || 0;
    });

    const messageList = this.data.messageList.map(function(msg) {
      if (msg.dishes && msg.dishes.length > 0) {
        const newDishes = msg.dishes.map(function(dish) {
          return Object.assign({}, dish, {
            dishNumber: cartMap[dish.id] || 0
          });
        });
        return Object.assign({}, msg, { dishes: newDishes });
      }
      return msg;
    });

    this.setData({ messageList: messageList });
  },

  computeCartTotals: function(orderListData) {
    let count = 0;
    let total = 0;
    orderListData.forEach(function(item) {
      count += item.number || 0;
      total += (item.number || 0) * (item.amount || 0);
    });
    return {
      orderDishNumber: count,
      orderDishPrice: total.toFixed(2)
    };
  },

  // 刷新购物车（从后端重新拉取）
  refreshCart: function() {
    const that = this;
    return request('/user/shoppingCart/list').then(function(list) {
      const orderListData = list || [];
      that.setData({
        orderAndUserInfo: orderListData,
        ...that.computeCartTotals(orderListData)
      });
      that.syncDishNumbers(orderListData);
    }).catch(function() {});
  },

  // ==================== 消息交互 ====================

  onInput: function(e) {
    this.setData({ inputValue: e.detail.value });
  },

  sendMessage: function() {
    const that = this;
    const { inputValue, messageList, currentSessionId } = this.data;
    if (!inputValue.trim()) return;

    // 添加用户消息到界面
    const userMsg = {
      id: Date.now(),
      role: 'user',
      content: inputValue
    };
    const newMessageList = [...messageList, userMsg];
    this.setData({
      messageList: newMessageList,
      inputValue: ''
    });
    this.scrollToBottom();

    // 显示加载状态
    wx.showLoading({ title: 'AI 思考中...' });

    // 调用后端 API
    request('/user/ai/chat', {
      method: 'POST',
      data: {
        message: inputValue,
        sessionId: currentSessionId
      }
    }).then(function(data) {
      wx.hideLoading();
      // data 是 ChatVO: { sessionId, content, dishes }
      const aiMsg = {
        id: Date.now() + 1,
        role: 'assistant',
        content: '',
        dishes: data.dishes || []
      };

      that.setData({
        messageList: [...that.data.messageList, aiMsg],
        currentSessionId: data.sessionId
      });

      // 流式逐字显示效果
      const fullContent = data.content || '';
      const msgIndex = that.data.messageList.length - 1;
      let charIndex = 0;
      const timer = setInterval(function() {
        if (charIndex < fullContent.length) {
          const newMsgList = that.data.messageList.slice();
          newMsgList[msgIndex] = Object.assign({}, newMsgList[msgIndex], {
            content: fullContent.substring(0, charIndex + 1)
          });
          that.setData({ messageList: newMsgList });
          charIndex++;
          that.scrollToBottom();
        } else {
          clearInterval(timer);
        }
      }, 30);

      // 重新加载购物车并同步菜品数量
      that.refreshCart();

      // 持久化当前会话ID
      wx.setStorageSync('ai_last_session_id', data.sessionId);

      that.scrollToBottom();
    }).catch(function(err) {
      wx.hideLoading();
      console.error('AI请求失败:', err);
      // 添加错误提示消息
      const errorMsg = {
        id: Date.now() + 1,
        role: 'assistant',
        content: '抱歉，AI 服务暂时不可用，请稍后再试。'
      };
      that.setData({
        messageList: [...that.data.messageList, errorMsg]
      });
    });
  },

  // ==================== 会话管理 ====================

  toggleSessions: function() {
    if (this.data.showSessions) {
      this.setData({ showSessions: false });
    } else {
      this.loadSessions();
      this.setData({ showSessions: true });
    }
  },

  switchSession: function(e) {
    const sessionId = e.currentTarget.dataset.sessionId;
    if (sessionId === this.data.currentSessionId) {
      this.setData({ showSessions: false });
      return;
    }
    this.setData({
      currentSessionId: sessionId,
      showSessions: false,
      messageList: []
    });
    wx.setStorageSync('ai_last_session_id', sessionId);
    this.loadMessages(sessionId);
  },

  newChat: function() {
    this.setData({
      currentSessionId: null,
      showSessions: false,
      messageList: [{
        id: Date.now(),
        role: 'assistant',
        content: '您好！我是您的智能点餐助手，告诉我您的口味偏好或者想吃什么，我会为您推荐美味菜品！'
      }]
    });
    wx.removeStorageSync('ai_last_session_id');
  },

  deleteSession: function(e) {
    const that = this;
    const sessionId = e.currentTarget.dataset.sessionId;
    wx.showModal({
      title: '确认删除',
      content: '确定要删除这个会话吗？',
      success: function(res) {
        if (res.confirm) {
          request('/user/ai/sessions/' + sessionId, { method: 'DELETE' }).then(function() {
            wx.showToast({ title: '已删除', icon: 'success' });
            // 如果删除的是当前会话，新建一个
            if (sessionId === that.data.currentSessionId) {
              that.newChat();
            }
            that.loadSessions();
          }).catch(function() {
            // 删除失败
          });
        }
      }
    });
  },

  // ==================== 购物车操作（走后端 API，与首页共享） ====================

  // 推荐菜品 - 加购
  recommendAdd: function(e) {
    const dishId = e.currentTarget.dataset.dishId;
    const dishName = e.currentTarget.dataset.dishName;

    request('/user/shoppingCart/add', {
      method: 'POST',
      data: { dishId: dishId }
    }).then(() => {
      wx.showToast({ title: `${dishName} 已加入购物车`, icon: 'success' });
      this.refreshCart();
    }).catch(() => {
      wx.showToast({ title: '加购失败', icon: 'none' });
    });
  },

  // 推荐菜品 - 减购
  recommendSub: function(e) {
    const dishId = e.currentTarget.dataset.dishId;

    request('/user/shoppingCart/sub', {
      method: 'POST',
      data: { dishId: dishId }
    }).then(() => {
      this.refreshCart();
    }).catch(() => {
      wx.showToast({ title: '操作失败', icon: 'none' });
    });
  },

  showCartDetail: function() {
    this.setData({ openCartPopup: true });
  },

  hideCartPopup: function() {
    this.setData({ openCartPopup: false });
  },

  addCartItem: function(e) {
    const index = e.currentTarget.dataset.index;
    const item = this.data.orderAndUserInfo[index];

    request('/user/shoppingCart/add', {
      method: 'POST',
      data: { dishId: item.dishId || item.id }
    }).then(() => {
      this.refreshCart();
    }).catch(() => {
      wx.showToast({ title: '操作失败', icon: 'none' });
    });
  },

  removeCartItem: function(e) {
    const index = e.currentTarget.dataset.index;
    const item = this.data.orderAndUserInfo[index];

    // 统一用 sub 接口减数量，后端 quantity<=0 时会自动删除
    request('/user/shoppingCart/sub', {
      method: 'POST',
      data: { dishId: item.dishId || item.id }
    }).then(() => {
      this.refreshCart();
    }).catch(() => {
      wx.showToast({ title: '操作失败', icon: 'none' });
    });
  },

  clearCart: function() {
    request('/user/shoppingCart/clean', { method: 'DELETE' }).then(() => {
      this.setData({
        orderAndUserInfo: [],
        orderDishNumber: 0,
        orderDishPrice: '0.00',
        openCartPopup: false
      });
    }).catch(() => {
      wx.showToast({ title: '清空失败', icon: 'none' });
    });
  },

  goCheckout: function() {
    if (this.data.orderDishNumber === 0) {
      wx.showToast({ title: '购物车是空的', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: '/pages/order/index' });
  },

  scrollToBottom: function() {
    setTimeout(() => {
      wx.createSelectorQuery().select('.message-list').boundingClientRect((rect) => {
        if (rect) {
          wx.pageScrollTo({
            scrollTop: rect.height,
            duration: 300
          });
        }
      }).exec();
    }, 100);
  }
});
