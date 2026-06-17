"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { User, Shield, Mail } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export default function ProfilePage() {
    const [isPasswordOpen, setIsPasswordOpen] = useState(false);

    const handleChangePassword = () => {
        toast.success("비밀번호가 성공적으로 변경되었습니다.");
        setIsPasswordOpen(false);
    };

    const handleLogout = () => {
        toast.message("로그아웃 되었습니다.", {
            description: "로그인 페이지로 이동합니다."
        });
    };

    return (
        <div className="space-y-8 max-w-4xl">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">설정</h1>
                <p className="text-muted-foreground mt-2">
                    계정 정보 및 보안 설정을 관리합니다.
                </p>
            </div>

            <div className="grid gap-6">
                {/* 1. Account Info */}
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <User className="h-5 w-5" />
                            계정 정보
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        <div className="flex items-center gap-4 p-4 border rounded-lg bg-slate-50 dark:bg-slate-900">
                            <div className="h-12 w-12 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 text-xl font-bold">
                                M
                            </div>
                            <div>
                                <div className="font-medium">Moon CEO</div>
                                <div className="text-sm text-muted-foreground flex items-center gap-1.5">
                                    <Mail className="h-3 w-3" />
                                    moon@jumunpangpang.com
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* 2. Security Actions */}
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Shield className="h-5 w-5" />
                            보안 및 작업
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex items-center justify-between py-2">
                            <div className="space-y-0.5">
                                <Label className="text-base">비밀번호 변경</Label>
                                <p className="text-sm text-muted-foreground">정기적인 비밀번호 변경으로 계정을 보호하세요.</p>
                            </div>
                            <Dialog open={isPasswordOpen} onOpenChange={setIsPasswordOpen}>
                                <DialogTrigger asChild>
                                    <Button variant="outline">변경하기</Button>
                                </DialogTrigger>
                                <DialogContent>
                                    <DialogHeader>
                                        <DialogTitle>비밀번호 변경</DialogTitle>
                                        <DialogDescription>
                                            새로운 비밀번호를 입력해주세요.
                                        </DialogDescription>
                                    </DialogHeader>
                                    <div className="space-y-4 py-4">
                                        <div className="space-y-2">
                                            <Label>현재 비밀번호</Label>
                                            <Input type="password" />
                                        </div>
                                        <Separator />
                                        <div className="space-y-2">
                                            <Label>새 비밀번호</Label>
                                            <Input type="password" />
                                        </div>
                                        <div className="space-y-2">
                                            <Label>새 비밀번호 확인</Label>
                                            <Input type="password" />
                                        </div>
                                    </div>
                                    <DialogFooter>
                                        <Button variant="outline" onClick={() => setIsPasswordOpen(false)}>취소</Button>
                                        <Button onClick={handleChangePassword}>변경 완료</Button>
                                    </DialogFooter>
                                </DialogContent>
                            </Dialog>
                        </div>

                        <Separator />

                        <div className="flex items-center justify-between py-2">
                            <div className="space-y-0.5">
                                <Label className="text-base text-red-600">로그아웃</Label>
                                <p className="text-sm text-muted-foreground">현재 기기에서 계정 연결을 종료합니다.</p>
                            </div>
                            <Button variant="ghost" className="text-red-600 hover:text-red-700 hover:bg-red-50" onClick={handleLogout}>
                                로그아웃
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
