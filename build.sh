#!/bin/bash

npm run build
rsync -av --delete dist/ 192.168.1.11:/var/www/dagpulse/


exit


# NGINX proxy config on 192.168.1.11 is:

# server {
    # server_name pulse.htn.foztor.net;
# 
    # location /dagpulse/ws {
        # proxy_pass http://192.168.1.10:8765/ws;
        # proxy_http_version 1.1;
        # proxy_set_header Upgrade $http_upgrade;
        # proxy_set_header Connection "upgrade";
        # proxy_set_header Host $host;
        # proxy_read_timeout 3600;
        # proxy_send_timeout 3600;
    # }
# 
    # location /dagpulse/ {
        # alias /var/www/dagpulse/;
        # try_files $uri $uri/ index.html;
    # }
# 
    # location = / {
        # return 301 /dagpulse/;
    # }
# 
    # listen 443 ssl;
    # ssl_certificate /etc/letsencrypt/live/pulse.htn.foztor.net/fullchain.pem;
    # ssl_certificate_key /etc/letsencrypt/live/pulse.htn.foztor.net/privkey.pem;
    # include /etc/letsencrypt/options-ssl-nginx.conf;
    # ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
# }
# 
# server {
    # if ($host = pulse.htn.foztor.net) {
        # return 301 https://$host$request_uri;
    # }
    # server_name pulse.htn.foztor.net;
    # listen 80;
    # return 404;
# }

