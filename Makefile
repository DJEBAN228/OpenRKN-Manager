include $(TOPDIR)/rules.mk

PKG_NAME:=openrkn
PKG_VERSION:=0.2.0
PKG_RELEASE:=1
PKG_LICENSE:=MIT

include $(INCLUDE_DIR)/package.mk

define Package/openrkn
  SECTION:=net
  CATEGORY:=Network
  TITLE:=OpenRKN procd and rpcd backend
  DEPENDS:=+rpcd +ubus +uci +libubox +jshn +uhttpd +uhttpd-mod-ubus +firewall4 +nftables-json +kmod-nft-queue +kmod-nfnetlink-queue
  USERID:=openrkn=453:openrkn=453
endef

define Package/openrkn/conffiles
/etc/config/openrkn
endef

define Build/Compile
endef

define Package/openrkn/install
	$(CP) ./files/* $(1)/
	chmod 0755 $(1)/etc/init.d/openrkn $(1)/usr/libexec/rpcd/openrkn $(1)/usr/libexec/openrkn/* $(1)/etc/uci-defaults/* 2>/dev/null || true
endef

$(eval $(call BuildPackage,openrkn))
